import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { hasDesktop, startRun } from "../src/launch.js";
import { acceptWebSocket } from "../../cli/src/run-ws.js";

const root = resolve(__dirname, "..");
let out = "", work = "", host: http.Server, hostPort = 0, sim: http.Server, simPort = 0, fake = "";
const seen: { type: string; [k: string]: unknown }[] = [];
let skinFile = "", failLog = false;
const TREE = '- button "Buy" [ref=e1]';

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  work = mkdtempSync(join(tmpdir(), "show-"));
  // A stand-in for `shipvo run <platform>`: writes run.json for the fake host and stays alive.
  fake = join(work, "fake-shipvo.mjs");
  writeFileSync(fake, `import { mkdirSync, writeFileSync } from "node:fs";
const platform = process.argv[process.argv.indexOf("run") + 1];
mkdirSync(".shipvo", { recursive: true });
writeFileSync(".shipvo/run.json", JSON.stringify({ port: Number(process.env.FAKE_PORT), platform, app: "menu", token: "tok", pid: process.pid }));
writeFileSync("started-" + platform, "1");
setTimeout(() => {}, 30000);`);
  sim = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/apps") return res.end(JSON.stringify({ ok: true, apps: [{ id: "menu" }] }));
    res.end(JSON.stringify({ ok: true, release: "local", screen: "heading Headless" }));
  });
  host = http.createServer();
  host.on("upgrade", (req, socket) => {
    const url = new URL(req.url!, "http://x");
    if (url.searchParams.get("token") !== "tok") return void socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    const peer = acceptWebSocket(req, socket, (t) => {
      const m = JSON.parse(t); seen.push(m);
      if (m.type === "skin") { peer?.send(JSON.stringify({ id: m.id, type: "skin", ok: true })); if (skinFile) writeFileSync(skinFile, JSON.stringify({ port: hostPort, platform: m.platform, app: "menu", token: "tok", pid: process.pid })); return; }
      if (m.type === "device_log" && failLog) return;
      if (m.type === "notifications") return void peer?.send(JSON.stringify({ id: m.id, ok: true, notifications: [{ id: "n1", title: "Hi" }], screen: TREE }));
      if (m.type === "get_settings") return void peer?.send(JSON.stringify({ id: m.id, ok: true, settings: { dark_mode: false, language: "en" }, screen: TREE }));
      if (m.type === "device_log") return void peer?.send(JSON.stringify({ id: m.id, ok: true, log: [{ kind: "permission", source: "simulated" }], capabilities: {}, screen: TREE }));
      peer?.send(JSON.stringify({ id: m.id, ok: true, screen: TREE }));
    }, () => {});
  });
  await Promise.all([new Promise<void>((r) => sim.listen(0, r)), new Promise<void>((r) => host.listen(0, "127.0.0.1", r))]);
  simPort = (sim.address() as { port: number }).port; hostPort = (host.address() as { port: number }).port;
});
afterAll(() => { sim?.close(); host?.close(); if (out) rmSync(out, { recursive: true, force: true }); if (work) rmSync(work, { recursive: true, force: true }); });

let n = 0;
async function open(args: Record<string, unknown>, setup: (project: string) => void = () => {}) {
  const project = join(work, `p${n++}`); mkdirSync(join(project, ".git"), { recursive: true });
  writeFileSync(join(project, "shipvo.json"), "{}");
  setup(project);
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${simPort}`, PN_CONTROL: "http://127.0.0.1:1", SHIPVO_RUN_COMMAND: JSON.stringify([process.execPath, fake]), FAKE_PORT: String(hostPort), DISPLAY: ":0" };
  delete env.PN_APPS; delete env.CI;
  const c = new Client({ name: "t", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env, cwd: project }));
  const r = await c.callTool({ name: "open_app", arguments: { app: "menu", ...args } }) as { content: { text: string }[] };
  return { c, project, text: r.content[0].text };
}
const runJson = (platform: string) => (p: string) => { mkdirSync(join(p, ".shipvo")); writeFileSync(join(p, ".shipvo", "run.json"), JSON.stringify({ port: hostPort, platform, app: "menu", token: "tok", pid: process.pid })); };

describe("open_app shows the phone", { timeout: 30_000 }, () => {
  it("platform ios with show true and no run starts one and attaches", async () => {
    const { c, text, project } = await open({ platform: "ios", show: true });
    expect(existsSync(join(project, "started-ios"))).toBe(true);
    expect(text).toContain("attached to the live shipvo run phone");
    expect(text).toContain(`visible: yes, ios phone at http://127.0.0.1:${hostPort}/`);
    await c.close();
  });
  it("show unset on a desktop starts nothing when the project has no local shipvo", async () => {
    const { c, text, project } = await open({});
    expect(existsSync(join(project, "started-android"))).toBe(false);
    expect(text).toContain("mode: headless session");
    await c.close();
  });
  it("a live android run switches to ios when ios is asked", async () => {
    seen.length = 0;
    const { c, text, project } = await open({ platform: "ios" }, (p) => { runJson("android")(p); skinFile = join(p, ".shipvo", "run.json"); });
    expect(existsSync(join(project, "started-ios"))).toBe(false);
    expect(seen.find((m) => m.type === "skin")?.platform).toBe("ios");
    expect(text).toContain("switched the phone from android to ios");
    expect(text).toContain("visible: yes, ios phone");
    skinFile = "";
    await c.close();
  });
  it("show true with no live run and no shipvo.json returns no_project", async () => {
    const project = join(work, `p${n++}`); mkdirSync(join(project, ".git"), { recursive: true });
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${simPort}`, PN_CONTROL: "http://127.0.0.1:1", DISPLAY: ":0" };
    delete env.CI;
    const c = new Client({ name: "t", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env, cwd: project }));
    const r = await c.callTool({ name: "open_app", arguments: { app: "menu", show: true } }) as { content: { text: string }[] };
    expect(r.content[0].text).toContain("no_project");
    await c.close();
  });
  it("device actions on an attached phone go to the bridge, with the notification id as nid", async () => {
    seen.length = 0;
    const { c, text } = await open({}, runJson("android"));
    const session = /session: (\S+)/.exec(text)![1];
    const call = async (name: string, args: Record<string, unknown>) => (await c.callTool({ name, arguments: { session, ...args } }) as { content: { text: string }[] }).content[0].text;
    expect(await call("set_device", { network: "offline" })).not.toContain("not_supported_attached");
    expect(seen.some((m) => m.type === "set_device")).toBe(true);
    expect(await call("notifications", {})).toContain("Hi");
    expect(await call("get_settings", {})).not.toContain("not_supported_attached");
    expect(seen.some((m) => m.type === "get_settings")).toBe(true);
    await call("dismiss_notification", { id: "n1" });
    const d = seen.find((m) => m.type === "dismiss_notification")!;
    expect(d.nid).toBe("n1");
    await c.close();
  });
  it("end_session lists network calls and still closes when the page does not answer device_log", async () => {
    const { c, text } = await open({}, runJson("android"));
    const session = /session: (\S+)/.exec(text)![1];
    failLog = true;
    const e = await c.callTool({ name: "end_session", arguments: { session } }) as { content: { text: string }[] };
    failLog = false;
    expect(JSON.parse(e.content[0].text).network).toEqual([]);
    await c.close();
  }, 30_000);
  it("tools the run does not answer say not_supported_attached", async () => {
    seen.length = 0;
    const { c, text } = await open({}, runJson("android"));
    const session = /session: (\S+)/.exec(text)![1];
    const sd = await c.callTool({ name: "press_home", arguments: { session } }) as { content: { text: string }[] };
    expect(sd.content[0].text).toContain("not_supported_attached");
    expect(seen.some((m) => m.type === "press_home")).toBe(false);
    await c.close();
  });
  it("refuses when the project's run is for another app", async () => {
    const { c, text, project } = await open({ app: "other", show: true });
    expect(existsSync(join(project, "started-android"))).toBe(true);
    expect(text).toContain("unknown_app");
    expect(text).toContain('project runs "menu", not "other"');
    await c.close();
  });
  it("a live run for another app is named and no second run starts", async () => {
    const { c, text, project } = await open({ app: "other", show: true }, runJson("android"));
    expect(text).toContain("unknown_app");
    expect(text).toContain('project runs "menu", not "other"');
    expect(existsSync(join(project, "started-android"))).toBe(false);
    await c.close();
  });
  it("show true over HTTP starts nothing and stays headless", async () => {
    const project = join(work, `p${n++}`); mkdirSync(join(project, ".git"), { recursive: true });
    writeFileSync(join(project, "shipvo.json"), "{}");
    const port = await new Promise<number>((ok) => { const s = http.createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); });
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${simPort}`, PN_CONTROL: "http://127.0.0.1:1", SHIPVO_RUN_COMMAND: JSON.stringify([process.execPath, fake]), FAKE_PORT: String(hostPort), DISPLAY: ":0", PN_API_KEYS: "", PN_APPS: "" };
    delete env.CI;
    const proc = spawn(process.execPath, [join(out, "server.js"), "--http", String(port)], { env, cwd: project, stdio: "pipe" });
    try {
      for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
      const r = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "open_app", arguments: { app: "menu", show: true } } }) });
      const body = (await r.json()) as any;
      expect(body.result.content[0].text).toContain("mode: headless session");
      expect(existsSync(join(project, "started-android"))).toBe(false);
    } finally { proc.kill(); }
  });
  it("a live run for another app does not block a plain headless open_app", async () => {
    const { c, text, project } = await open({}, (p) => { mkdirSync(join(p, ".shipvo")); writeFileSync(join(p, ".shipvo", "run.json"), JSON.stringify({ port: hostPort, platform: "android", app: "shop", token: "tok", pid: process.pid })); });
    expect(text).toContain("mode: headless session");
    expect(text).not.toContain("unknown_app");
    expect(existsSync(join(project, "started-android"))).toBe(false);
    await c.close();
  });
  it("platform is reported as ignored when show is false", async () => {
    const { c, text } = await open({ platform: "ios", show: false });
    expect(text).toContain("platform ios ignored");
    await c.close();
  });
  it("a bad SHIPVO_RUN_COMMAND names the variable", async () => {
    const old = process.env.SHIPVO_RUN_COMMAND; process.env.SHIPVO_RUN_COMMAND = "not json";
    try { await expect(startRun("android", work, 200)).rejects.toThrow(/SHIPVO_RUN_COMMAND/); } finally { if (old === undefined) delete process.env.SHIPVO_RUN_COMMAND; else process.env.SHIPVO_RUN_COMMAND = old; }
  });
  it("show false stays headless and starts nothing", async () => {
    const { c, text, project } = await open({ platform: "ios", show: false });
    expect(text).toContain("mode: headless session");
    expect(text).toContain("visible: no");
    expect(existsSync(join(project, "started-ios"))).toBe(false);
    await c.close();
  });
});

describe("launch helpers", () => {
  it("hasDesktop is false in CI and on Linux without a display", () => {
    expect(hasDesktop({ CI: "true", DISPLAY: ":0" }, "linux")).toBe(false);
    expect(hasDesktop({ DISPLAY: ":0" }, "linux")).toBe(true);
    expect(hasDesktop({}, "linux")).toBe(false);
    expect(hasDesktop({ CI: "false" }, "darwin")).toBe(true);
  });
  it("startRun reports a command that exits early", async () => {
    const dir = mkdtempSync(join(tmpdir(), "early-"));
    process.env.SHIPVO_RUN_COMMAND = JSON.stringify([process.execPath, "-e", "process.exit(3)"]);
    try { await expect(startRun("ios", dir, 5000)).rejects.toThrow(/stopped before the phone was ready/); }
    finally { delete process.env.SHIPVO_RUN_COMMAND; rmSync(dir, { recursive: true, force: true }); }
  });
});
