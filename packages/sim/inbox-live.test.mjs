// The private inbox against a real sim server and a small sign-in page: request a code, read it from the inbox, type it, see Home.
import { pickPort } from "./test-port.mjs";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(12600, 100);
const root = mkdtempSync(join(tmpdir(), "sim-inbox-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;
const PAGE = `<!doctype html><html><head><title>Sign in</title></head><body><h1 id="h">Sign in</h1>
<script>
window.sent = null;
window.request = async () => {
  const to = document.getElementById("email").value;
  const code = "482913";
  const r = await fetch("https://inbox.shipvo.test/send", { method: "POST", body: JSON.stringify({ to, from: "login@shop.test", subject: "Your sign-in code", text: "Your code is " + code + ". It expires in 10 minutes. Or open https://shop.test/magic?t=abc123." }) });
  window.sent = code; document.getElementById("h").textContent = r.status === 202 ? "Check your email" : "Mail refused " + r.status;
};
window.verify = () => { document.getElementById("h").textContent = document.getElementById("code").value === window.sent ? "Home" : "Wrong code"; };
window.requestStub = async () => { await fetch("https://api.shop.test/login", { method: "POST" }); document.getElementById("h").textContent = "Check your email"; };
</script>
<div><input id="email" aria-label="Email"></div><div><button onclick="request()">Send code</button></div><div><button onclick="requestStub()">Send via stub</button></div>
<div><input id="code" aria-label="Code"></div><div><button onclick="verify()">Verify</button></div></body></html>`;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
function ensureChromium() {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (existsSync(pw.chromium.executablePath())) return;
  const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
  if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
}
before(async () => {
  ensureChromium();
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), PAGE);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start within 90 s. stderr: ${err || "(empty)"}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

const ref = (screen, name) => { const m = new RegExp(`${name}[^\\n]*\\[ref=(\\w+)\\]`).exec(screen); assert.ok(m, screen); return m[1]; };
async function tapNamed(session, name) { const s = (await act(session, { action: "screen" })).screen; return act(session, { action: "tap", ref: ref(s, name) }); }
async function typeInto(session, name, text) { const s = (await act(session, { action: "screen" })).screen; return act(session, { action: "type", ref: ref(s, name), text }); }
async function until(session, re) { for (let i = 0; i < 40; i++) { const r = await act(session, { action: "screen" }); if (re.test(r.screen)) return r.screen; await new Promise((r) => setTimeout(r, 100)); } assert.fail(`never saw ${re}: ${(await act(session, { action: "screen" })).screen}`); }

test("request a code, inbox_wait returns it, type it, Home shows", async () => {
  assert.ok((await call("/session", { session: "a" })).ok);
  const { address } = await act("a", { action: "inbox_read" });
  assert.match(address, /^s-[0-9a-f]{12}@inbox\.shipvo\.test$/);
  await typeInto("a", '"Email"', address);
  await tapNamed("a", "Send code");
  const w = await act("a", { action: "inbox_wait", subject: "sign-in", timeout_ms: 5000 });
  assert.equal(w.ok, true, w.error);
  assert.deepEqual(w.message.codes, ["482913"]);
  assert.deepEqual(w.message.links, ["https://shop.test/magic?t=abc123"]);
  assert.equal(w.message.from, "login@shop.test");
  await typeInto("a", '"Code"', w.message.codes[0]);
  const v = await tapNamed("a", "Verify"); assert.equal(v.ok, true, JSON.stringify(v));
  assert.match(await until("a", /Home/), /Home/);
});

test("inbox_wait returns mail that arrives while it waits", async () => {
  assert.ok((await call("/session", { session: "late" })).ok);
  const { address } = await act("late", { action: "inbox_read" });
  const waiting = act("late", { action: "inbox_wait", timeout_ms: 8000 });
  await new Promise((r) => setTimeout(r, 300));
  await typeInto("late", '"Email"', address);
  await tapNamed("late", "Send code");
  const w = await waiting;
  assert.equal(w.ok, true, w.error);
  assert.equal(w.message.subject, "Your sign-in code");
});

test("inbox_read twice gives the same result, and clear empties it", async () => {
  const one = await act("a", { action: "inbox_read" }); const two = await act("a", { action: "inbox_read" });
  assert.equal(one.messages.length, 1);
  assert.deepEqual(two, one);
  assert.equal((await act("a", { action: "inbox_wait", timeout_ms: 0 })).ok, true, "waiting does not consume mail");
  assert.deepEqual(await act("a", { action: "inbox_read", subject: "nothing like this" }).then((r) => r.messages), []);
  assert.equal((await act("a", { action: "inbox_clear" })).cleared, 1);
  assert.deepEqual((await act("a", { action: "inbox_read" })).messages, []);
});

test("two sessions never see each other's mail; mail to another address is refused", async () => {
  assert.ok((await call("/session", { session: "b" })).ok); assert.ok((await call("/session", { session: "c" })).ok);
  const a = (await act("b", { action: "inbox_read" })).address; const c = (await act("c", { action: "inbox_read" })).address;
  assert.notEqual(a, c);
  await typeInto("b", '"Email"', a); await tapNamed("b", "Send code");
  assert.equal((await act("b", { action: "inbox_wait", timeout_ms: 5000 })).ok, true);
  assert.deepEqual((await act("c", { action: "inbox_read" })).messages, []);
  // c's app sends to b's address: refused, and b gets nothing new.
  await typeInto("c", '"Email"', a); await tapNamed("c", "Send code");
  assert.match(await until("c", /Mail refused 550/), /550/);
  assert.equal((await act("b", { action: "inbox_read" })).messages.length, 1);
  assert.deepEqual((await act("c", { action: "inbox_read" })).messages, []);
});

test("a missing mail is a typed timeout, not a hang", async () => {
  assert.ok((await call("/session", { session: "t" })).ok);
  const t0 = Date.now();
  const r = await act("t", { action: "inbox_wait", subject: "never", timeout_ms: 400 });
  assert.equal(r.ok, false); assert.equal(r.code, "inbox_timeout");
  assert.ok(Date.now() - t0 < 3000);
  assert.equal((await act("t", { action: "inbox_wait", timeout_ms: 99999 })).code, "bad_timeout");
});

test("a mock rule with mail delivers it to the session's own inbox", async () => {
  assert.ok((await call("/session", { session: "m" })).ok);
  const rules = [{ url: "https://api.shop.test/login", method: "POST", response: { status: 200, body: "{}", headers: {}, mail: { subject: "Code 7741", text: "Use 7741 to sign in." } } }];
  assert.equal((await act("m", { action: "set_network_mocks", rules })).ok, true);
  await tapNamed("m", "Send via stub");
  const w = await act("m", { action: "inbox_wait", timeout_ms: 5000 });
  assert.deepEqual(w.message.codes, ["7741"]);
  assert.equal((await act("m", { action: "set_network_mocks", rules: [{ url: "/x", response: { status: 200, body: "", mail: { subject: 5 } } }] })).code, "mock_invalid");
});

test("ending a session removes its inbox and fails a pending wait", async () => {
  assert.ok((await call("/session", { session: "z" })).ok);
  const pending = act("z", { action: "inbox_wait", timeout_ms: 10000 });
  await new Promise((r) => setTimeout(r, 200));
  await call("/end", { session: "z" });
  const r = await pending; assert.equal(r.ok, false); assert.equal(r.code, "session_ended");
  assert.equal((await act("z", { action: "inbox_read" })).code, "no_session");
});
