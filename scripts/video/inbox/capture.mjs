#!/usr/bin/env node
// Captures the real Assistant Inbox screens for the "Two assistants, one phone" video.
//   node scripts/video/inbox/capture.mjs <outdir>
// Starts the simulator, installs templates/assistant-inbox/app.json on an Android and an iOS session, then plays two
// assistants (agent "openai-mcp" = chatgpt, "claude-ai" = claude) through one exchange. Framed screenshots land in <outdir>.
import { readFileSync, mkdirSync, copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = resolve(process.argv[2] || "/tmp/agent/inbox-shots"); mkdirSync(out, { recursive: true });
const PORT = 4791, tmp = mkdtempSync(join(tmpdir(), "inbox-cap-")), dist = join(tmp, "dist");
mkdirSync(dist); writeFileSync(join(dist, "index.html"), "<!doctype html><title>home</title><h1>Home</h1>");
const proc = spawn(process.execPath, [join(root, "packages/sim/server.mjs"), "--port", String(PORT), "--dir", join(tmp, "state"), "--dist", dist, "--host", "127.0.0.1"], { stdio: "inherit", cwd: join(root, "packages/sim") });
const INBOX = JSON.parse(readFileSync(join(root, "templates/assistant-inbox/app.json"), "utf8"));
const call = async (p, b) => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: "POST", body: JSON.stringify(b) })).json();
for (let i = 0; i < 300; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
const CHATGPT = "openai-mcp", CLAUDE = "claude-ai";
const log = [];
try {
  for (const style of ["android", "ios"]) {
    const s = "inbox-" + style;
    await call("/session", { session: s, fit_frame: true, skin: style });
    const act = (b) => call("/act", { session: s, ...b });
    const as = (agent, name, input) => act({ action: "app_action", id: "inbox", action_name: name, input, agent });
    const shot = async (n) => { const r = await act({ action: "screenshot", frame: true }); copyFileSync(r.path, join(out, `${style}-${n}.png`)); return r; };
    const created = await act({ action: "create_app", id: "inbox", spec: INBOX, style });
    if (!created.ok) throw new Error(JSON.stringify(created).slice(0, 500));
    await shot("01-empty");
    log.push(["send", await as(CHATGPT, "send_message", { to: "claude", body: "Can you review my checkout plan?" })]);
    await shot("02-message");
    log.push(["banner", await act({ action: "pending_banner", agent: CLAUDE })]);
    log.push(["check", await as(CLAUDE, "check_inbox", {})]);
    log.push(["reply", await as(CLAUDE, "send_message", { to: "chatgpt", body: "Yes. Send it over as a task." })]);
    log.push(["handoff", await as(CHATGPT, "hand_off", { to: "claude", title: "Review checkout plan", detail: "Look for steps a shopper could get stuck on." })]);
    await shot("03-thread");
    const tab = async (name) => { const sc = (await act({ action: "screen" })).screen; const ref = new RegExp(`"${name}" \\[ref=(\\w+)\\]`).exec(sc)?.[1]; if (!ref) throw new Error("no tab " + name + "\n" + sc.slice(0, 800)); await act({ action: "tap", ref }); };
    await tab("Tasks"); await shot("03b-task-open"); await tab("Messages");
    const tasks = await as(CLAUDE, "my_tasks", {}); log.push(["my_tasks", tasks]);
    const id = JSON.stringify(tasks).match(/"id":"([^"]+)"/)?.[1];
    log.push(["wrong_assistant", await as(CHATGPT, "finish_task", { id, reply: "Done" })]);   // chatgpt is not the assignee
    log.push(["start", await as(CLAUDE, "start_task", { id })]);
    log.push(["finish", await as(CLAUDE, "finish_task", { id, reply: "Plan looks good. Add a back button on the cart." })]);
    log.push(["sent", await as(CHATGPT, "sent_tasks", {})]);
    log.push(["view", await act({ action: "inbox_view", agent: CHATGPT })]);
    await tab("Tasks"); await shot("04-done");   // the task is done and shows its reply
    log.push(["screen", (await act({ action: "screen" })).screen]);
  }
} finally { proc.kill("SIGKILL"); }
writeFileSync(join(out, "log.json"), JSON.stringify(log, null, 1));
console.log("wrote", out);
process.exit(0);
