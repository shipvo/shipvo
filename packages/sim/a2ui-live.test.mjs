// A2UI on the phone, end to end: an agent's messages become a screen, a person's typing and taps come back as A2UI actions.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";
import { BASIC_CATALOG_ID, SHIPVO_CATALOG_ID } from "./a2ui.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(13500, 150);   // own port range
const root = mkdtempSync(join(tmpdir(), "sim-a2ui-"));
let proc;

const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
const m = (kind, body) => ({ version: "1.0", [kind]: body });
const ref = (tree, re) => { const x = re.exec(tree); assert.ok(x, `${re} not on the screen:\n${tree}`); return x[1]; };
const pngSize = (file) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

const SIGNUP = [
  m("createSurface", { surfaceId: "signup", catalogId: BASIC_CATALOG_ID, dataModel: { form: { email: "", plan: ["free"] }, seats: 3 }, components: [
    { id: "root", component: "Column", children: ["title", "stat", "email", "plan", "agree", "send"] },
    { id: "title", component: "Text", text: "Create your account" },
    { id: "stat", component: "Stat", "@catalogId": SHIPVO_CATALOG_ID, label: "Seats left", value: { "@path": "/seats" } },
    { id: "email", component: "TextField", label: "Email", value: { "@path": "/form/email" }, "@checks": [{ condition: { "@call": "email", args: { value: { "@path": "/form/email" } } }, message: "Enter a valid email" }] },
    { id: "plan", component: "ChoicePicker", label: "Plan", options: [{ label: "Free", value: "free" }, { label: "Pro", value: "pro" }], value: { "@path": "/form/plan" } },
    { id: "agree", component: "CheckBox", label: "I agree to the terms", value: { "@path": "/form/agree" } },
    { id: "send", component: "Button", variant: "primary", child: "sendLabel", action: { event: { name: "create_account", context: { email: { "@path": "/form/email" }, plan: { "@path": "/form/plan" } } } }, "@checks": [{ condition: { "@path": "/form/agree" }, message: "Agree to the terms first" }] },
    { id: "sendLabel", component: "Text", text: "Create account" },
  ] }),
];

function ensureChromium() {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (existsSync(pw.chromium.executablePath())) return;
  const r = spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("could not install Chromium for playwright");
}

before(async () => {
  ensureChromium();
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", join(root, "state"), "--dist", join(root, "no-build")], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await call("/sessions", {}); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start listening on port ${PORT} within 90 s: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("an A2UI surface opens on a phone model with no app build, as a screen an agent can read", async () => {
  const r = await call("/session", { session: "a1", a2ui: true, a2ui_messages: SIGNUP, model: "iPhone 16 Pro" });
  assert.ok(r.ok, r.error);
  assert.equal(r.model, "iPhone 16 Pro");
  for (const want of ['Create your account', 'textbox "Email"', 'checkbox "I agree to the terms"', 'radio "Free" [checked]', 'radio "Pro"', 'button "Create account" [disabled]', 'status "Seats left: 3"', "Enter a valid email"]) assert.ok(r.screen.includes(want), `${want} not in:\n${r.screen}`);
});

test("typing, ticking and tapping work, and the tap reaches the agent as an A2UI action", async () => {
  await call("/session", { session: "a2", a2ui: true, a2ui_messages: SIGNUP, model: "Pixel 8" });
  let tree = (await act("a2", { action: "screen" })).screen;
  const typed = await act("a2", { action: "type", ref: ref(tree, /textbox "Email"[^\n]*\[ref=(\w+)\]/), text: "ada@example.com" });
  assert.ok(typed.ok, typed.error);
  tree = (await act("a2", { action: "screen" })).screen;
  assert.doesNotMatch(tree, /Enter a valid email/);
  await act("a2", { action: "tap", ref: ref(tree, /radio "Pro"[^\n]*\[ref=(\w+)\]/) });
  tree = (await act("a2", { action: "screen" })).screen;
  await act("a2", { action: "tap", ref: ref(tree, /checkbox "I agree to the terms"[^\n]*\[ref=(\w+)\]/) });
  tree = (await act("a2", { action: "screen" })).screen;
  assert.match(tree, /checkbox "I agree to the terms" \[checked\]/);
  assert.doesNotMatch(tree, /button "Create account" \[disabled\]/);
  const tap = await act("a2", { action: "tap", ref: ref(tree, /button "Create account"[^\n]*\[ref=(\w+)\]/) });
  assert.ok(tap.ok, tap.error);
  const out = await act("a2", { action: "a2ui_actions" });
  assert.equal(out.messages.length, 1);
  const a = out.messages[0].action;
  assert.deepEqual({ name: a.name, surfaceId: a.surfaceId, sourceComponentId: a.sourceComponentId, context: a.context }, { name: "create_account", surfaceId: "signup", sourceComponentId: "send", context: { email: "ada@example.com", plan: ["pro"] } });
  assert.match(a.timestamp, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual((await act("a2", { action: "a2ui_actions", since: out.next })).messages, []);
});

test("messages sent later change the open screen one piece at a time", async () => {
  await call("/session", { session: "a3", a2ui: true, a2ui_messages: SIGNUP });
  const one = await act("a3", { action: "a2ui_send", messages: [m("updateDataModel", { surfaceId: "signup", path: "/seats", value: 1 })] });
  assert.deepEqual([one.applied, one.errors], [1, []]);
  assert.match(one.screen, /status "Seats left: 1"/);
  assert.match(one.screen, /Create your account/, "the rest of the screen stays");
  const two = await act("a3", { action: "a2ui_send", jsonl: [m("updateComponents", { surfaceId: "signup", components: [{ id: "title", component: "Text", text: "Almost full" }] }), m("createSurface", { surfaceId: "note", components: [{ id: "root", component: "Text", text: "A second surface" }] })].map((x) => JSON.stringify(x)).join("\n") });
  assert.equal(two.applied, 2);
  assert.deepEqual(two.surfaces, ["signup", "note"]);
  assert.match(two.screen, /Almost full/); assert.match(two.screen, /A second surface/); assert.doesNotMatch(two.screen, /Create your account/);
  const bad = await act("a3", { action: "a2ui_send", messages: [m("updateComponents", { surfaceId: "signup", components: [{ id: "x", component: "Script" }] })] });
  assert.equal(bad.applied, 0); assert.equal(bad.errors[0].code, "VALIDATION_FAILED");
  assert.match(bad.screen, /Almost full/, "a refused message changes nothing");
});

test("the phone in its frame can be screenshotted, the catalog is served, and other sessions refuse A2UI actions", async () => {
  await call("/session", { session: "a4", a2ui: true, a2ui_messages: SIGNUP, model: "iPhone 16" });
  const shot = await act("a4", { action: "screenshot", frame: true });
  assert.ok(shot.ok, shot.error);
  const [w, h] = pngSize(shot.path); assert.ok(w > 800 && h > 1700, `${w}x${h}`);
  const cat = await (await fetch(`http://localhost:${PORT}/a2ui/catalog.json`)).json();
  assert.equal(cat.catalogId, SHIPVO_CATALOG_ID); assert.deepEqual(Object.keys(cat.components), ["Stat", "Badge", "Progress"]);
  assert.equal((await fetch(`http://localhost:${PORT}/a2ui/nobody/`)).status, 404);
  await call("/end", { session: "a4" });
  assert.equal((await fetch(`http://localhost:${PORT}/a2ui/a4/html`)).status, 404, "an ended session's surfaces are gone");
});
