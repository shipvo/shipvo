// Live: assistant A sends a message to B in the Assistant Inbox; the local receiver gets the signed POST with no tool call from B.
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";
import { sign } from "./wakeup.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(12900, 50);
const root = mkdtempSync(join(tmpdir(), "sim-wakeup-"));
const dist = join(root, "dist"), dir = join(root, "state");
let proc, hook; const got = [];
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });

before(async () => {
  hook = createServer(async (req, res) => { let raw = ""; for await (const c of req) raw += c; got.push({ raw, sig: req.headers["x-shipvo-signature"] }); res.writeHead(204); res.end(); });
  await new Promise((r) => hook.listen(0, "127.0.0.1", r));
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), "<!doctype html><title>home</title><h1>Home</h1>");
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here, env: { ...process.env, SHIPVO_WAKEUP_ALLOW_LOCAL: "1" } });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  assert.ok(up, "sim did not start");
});
after(async () => {
  hook?.close();
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("a message from assistant A to name B posts a signed webhook; device_log lists the attempt", async () => {
  const INBOX = JSON.parse(readFileSync(new URL("../../templates/assistant-inbox/app.json", import.meta.url), "utf8"));
  assert.ok((await call("/session", { session: "wk" })).ok);
  assert.equal((await act("wk", { action: "create_app", id: "inbox", spec: INBOX })).ok, true);
  const reg = await act("wk", { action: "register_wakeup", name: "claude", url: `http://127.0.0.1:${hook.address().port}/wake`, events: ["message"] });
  assert.equal(reg.ok, true, JSON.stringify(reg));
  assert.match(reg.wakeup.secret, /^[0-9a-f]{64}$/);
  assert.equal((await act("wk", { action: "list_wakeups" })).wakeups[0].secret, undefined);
  assert.equal((await act("wk", { action: "app_action", id: "inbox", action_name: "send_message", input: { to: "claude", body: "Please test checkout." }, agent: "openai-mcp" })).ok, true);
  for (let i = 0; i < 50 && !got.length; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(got.length, 1);
  assert.deepEqual(JSON.parse(got[0].raw), { to: "claude", event: "message", summary: "New message from chatgpt: Please test checkout." });
  assert.equal(got[0].sig, sign(reg.wakeup.secret, got[0].raw));
  const log = (await act("wk", { action: "device_log" })).log.filter((e) => e.name === "wakeup_attempt");
  assert.deepEqual(log.map((e) => [e.wakeup, e.attempt, e.ok, e.source]), [["claude", 1, true, "simulated"]]);
});
