import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { connectDriver } from "../src/attach.js";
import { acceptWebSocket } from "../../cli/src/run-ws.js";

const root = resolve(__dirname, "..");
let out = "", work = "", sim: http.Server, host: http.Server, simPort = 0, hostPort = 0;
const sessionBodies: Record<string, unknown>[] = [];
const seen: { type: string; [k: string]: unknown }[] = [];
let shotSource = "tab-capture";
const PNG = Buffer.from("png-bytes").toString("base64");
const TREE = '- button "Buy" [ref=e1]';

// How the mock simulator answers /session for a given session name: echo the asked platform, report none, or report android.
const SIM_REPORTS_NO_PLATFORM = "sim-no-platform";
const SIM_REPORTS_ANDROID = "sim-reports-android";
const simPlatform = (session: string, asked?: string) => session === SIM_REPORTS_NO_PLATFORM ? undefined : session === SIM_REPORTS_ANDROID ? "android" : asked;

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  work = mkdtempSync(join(tmpdir(), "attach-"));
  writeFileSync(join(work, "headless.png"), "headless-bytes");
  mkdirSync(join(work, ".git"));
  sim = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/apps") return res.end(JSON.stringify({ ok: true, apps: [{ id: "menu" }] }));
    if (req.url === "/session") { const b = JSON.parse(raw || "{}"); sessionBodies.push(b); const reported = simPlatform(b.session, b.device?.platform); return res.end(JSON.stringify({ ok: true, release: "local", ...(reported ? { platform: reported } : {}), screen: "heading Headless" })); }
    if (JSON.parse(raw || "{}").action === "screenshot") return res.end(JSON.stringify({ ok: true, path: join(work, "headless.png"), screen: "heading Headless" }));
    res.end(JSON.stringify({ ok: true, screen: "heading Headless" }));
  });
  host = http.createServer();
  host.on("upgrade", (req, socket) => {
    const url = new URL(req.url!, "http://x");
    if (url.searchParams.get("token") !== "tok" || url.searchParams.get("role") !== "driver") return void socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    const peer = acceptWebSocket(req, socket, (t) => {
      const m = JSON.parse(t); seen.push(m);
      if (m.type === "screenshot") return void peer?.send(JSON.stringify({ id: m.id, ok: true, source: shotSource, image: PNG, unsupported: shotSource === "rendered" ? ["video"] : undefined, screen: TREE }));
      if (m.type === "back") return void peer?.send(JSON.stringify({ id: m.id, ok: false, code: "taken_over", error: "the person took over" }));
      peer?.send(JSON.stringify({ id: m.id, ok: true, screen: TREE }));
    }, () => {});
  });
  await Promise.all([new Promise<void>((r) => sim.listen(0, r)), new Promise<void>((r) => host.listen(0, "127.0.0.1", r))]);
  simPort = (sim.address() as { port: number }).port; hostPort = (host.address() as { port: number }).port;
});
afterAll(() => { sim?.close(); host?.close(); if (out) rmSync(out, { recursive: true, force: true }); if (work) rmSync(work, { recursive: true, force: true }); });

const runJson = (pid: number, token = "tok", app = "menu") => { mkdirSync(join(work, ".shipvo"), { recursive: true }); writeFileSync(join(work, ".shipvo", "run.json"), JSON.stringify({ port: hostPort, platform: "android", app, token, pid })); };
async function open(args: Record<string, unknown>, app = "menu") {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${simPort}`, PN_CONTROL: "http://127.0.0.1:1" };
  delete env.PN_APPS;
  const sub = join(work, "a", "b"); mkdirSync(sub, { recursive: true }); // a parent holds run.json
  const c = new Client({ name: "t", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env, cwd: sub }));
  const r = await c.callTool({ name: "open_app", arguments: { app, ...args } }) as { content: { text: string }[]; isError?: boolean };
  return { c, text: r.content[0].text, isError: r.isError };
}

// Each open() starts a server process; two of them can pass 5 s on a busy CI runner.
describe("open_app attach", { timeout: 30_000 }, () => {
  it("attaches to a live run and routes actions through it", async () => {
    runJson(process.pid);
    const { c, text } = await open({});
    expect(text).toContain("attached to the live shipvo run phone");
    expect(text).toContain(TREE);
    const t = await c.callTool({ name: "tap", arguments: { session: /session: (\S+)/.exec(text)![1], ref: "e1" } }) as { content: { text: string }[] };
    expect(t.content[0].text).toContain(TREE);
    expect(seen.some((m) => m.type === "tap" && m.ref === "e1")).toBe(true);
    // Lumi is told about the open from the real result (#874); the page captions tap, type, scroll and back itself.
    expect(seen.some((m) => m.type === "lumi" && m.caption === "Opened menu" && m.state === "working")).toBe(true);
    await c.close();
  });
  it("sends platform to the simulator and reports the phone it opened", async () => {
    const { c, text } = await open({ attach: "never", platform: "ios", session: "p-ios" });
    expect(text).toContain("platform: ios");
    expect(sessionBodies.find((b) => b.session === "p-ios")?.device?.platform).toBe("ios");
    expect(sessionBodies.find((b) => b.session === "p-ios")?.platform).toBeUndefined();
    await c.close();
  });
  it("does not error when the simulator reports no platform", async () => {
    const { c, text, isError } = await open({ attach: "never", platform: "ios", session: SIM_REPORTS_NO_PLATFORM });
    expect(isError).toBeFalsy(); expect(text).not.toContain("platform:"); expect(text).toContain("mode: headless session"); await c.close();
  });
  it("errors when the simulator opens a different platform than asked", async () => {
    const { c, text, isError } = await open({ attach: "never", platform: "ios", session: SIM_REPORTS_ANDROID });
    expect(isError).toBe(true); expect(text).toContain("platform_mismatch"); expect(text).toContain("opened android");
    await c.close();
  });
  it("attaches to a live run of the other platform and says so", async () => {
    runJson(process.pid); // the live run is android
    const a = await open({ attach: "always", platform: "ios" });
    expect(a.isError).toBeFalsy(); expect(a.text).toContain("attached to the live shipvo run phone"); expect(a.text).toContain("the live phone is android"); await a.c.close();
    const ok = await open({ platform: "android" });
    expect(ok.text).toContain("attached to the live shipvo run phone"); await ok.c.close();
  });
  it("attaches to the live run's app without a simulator that knows it", async () => {
    runJson(process.pid, "tok", "founder");
    const { c, text } = await open({ attach: "always" }, "founder");
    expect(text).toContain("attached to the live shipvo run phone");
    await c.close();
    const h = await open({ attach: "never" }, "founder");
    expect(h.isError).toBe(true); expect(h.text).toContain("unknown_app"); await h.c.close();
  });
  it("a key scoped to another app cannot open the live run's app", async () => {
    runJson(process.pid, "tok", "founder");
    const port = await new Promise<number>((ok) => { const s = http.createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); });
    const env = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${simPort}`, PN_CONTROL: "http://127.0.0.1:1", PN_API_KEYS: "", PN_APPS: "" };
    const sub = join(work, "a", "b"); mkdirSync(sub, { recursive: true });
    const proc = spawn(process.execPath, [join(out, "server.js"), "--http", String(port)], { env, cwd: sub, stdio: "pipe" });
    try {
      for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
      const call = async (app: string) => {
        const r = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-shipvo-app": "menu" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "open_app", arguments: { app } } }) });
        return ((await r.json()) as any).result;
      };
      const denied = await call("founder");
      expect(denied.isError).toBe(true); expect(denied.content[0].text).toContain("unknown_app");
      expect(denied.content[0].text).toContain("this key opens: menu");
    } finally { proc.kill(); }
  });
  it("attach_session attaches without an app id, and errors when no run is live", async () => {
    runJson(process.pid, "tok", "founder");
    const { c, text } = await open({ attach: "never" });
    await text; // a headless open first, to get a connected client
    const r = await c.callTool({ name: "attach_session", arguments: {} }) as { isError?: boolean; content: { text: string }[] };
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain("app: founder");
    expect(r.content[0].text).toContain("attached to the live shipvo run phone");
    const other = await c.callTool({ name: "attach_session", arguments: { app: "someotherapp" } }) as { isError?: boolean; content: { text: string }[] };
    expect(other.isError).toBe(true); expect(other.content[0].text).toContain("no_live_run");
    runJson(2 ** 22 + 12345);
    const n = await c.callTool({ name: "attach_session", arguments: {} }) as { isError?: boolean; content: { text: string }[] };
    expect(n.isError).toBe(true); expect(n.content[0].text).toContain("no_live_run");
    await c.close();
  });
  it("maps taken_over to a clear tool error", async () => {
    runJson(process.pid);
    const { c, text } = await open({});
    const r = await c.callTool({ name: "back", arguments: { session: /session: (\S+)/.exec(text)![1] } }) as { isError?: boolean; content: { text: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("taken_over");
    expect(r.content[0].text).toContain("the person took over");
    expect(r.content[0].text).toContain("Hand back");
    await c.close();
  });
  it("falls back to headless when the pid is dead", async () => {
    runJson(2 ** 22 + 12345);
    const { c, text } = await open({});
    expect(text).toContain("headless session");
    await c.close();
  });
  it("never ignores a live run; always errors without one", async () => {
    runJson(process.pid);
    const n = await open({ attach: "never" });
    expect(n.text).toContain("headless session"); await n.c.close();
    runJson(2 ** 22 + 12345);
    const a = await open({ attach: "always" });
    expect(a.isError).toBe(true); expect(a.text).toContain("no_live_run"); await a.c.close();
  });
  it("says why in the headless result when attach failed", async () => {
    runJson(process.pid, "wrong");
    const { c, text } = await open({});
    expect(text).toContain("mode: headless session (live run found but attach failed:");
    await c.close();
  });
  it("connectDriver rejects clearly without a global WebSocket", async () => {
    const orig = globalThis.WebSocket;
    (globalThis as { WebSocket?: unknown }).WebSocket = undefined;
    try { await expect(connectDriver({ port: 1, platform: "android", app: "menu", token: "t", pid: 1 })).rejects.toThrow("attach needs Node 22+"); }
    finally { globalThis.WebSocket = orig; }
  });
});

// Slice 5 of #448: every screenshot result says where the pixels came from.
describe("screenshot source", { timeout: 30_000 }, () => {
  type R = { content: { type: string; text?: string; data?: string }[] };
  const shot = async (c: Client, text: string) => await c.callTool({ name: "screenshot", arguments: { session: /session: (\S+)/.exec(text)![1] } }) as R;
  it("tab-capture: the attached phone's image and source come through", async () => {
    runJson(process.pid); shotSource = "tab-capture";
    const { c, text } = await open({}); const r = await shot(c, text);
    expect(r.content[0].data).toBe(PNG);
    expect(r.content[1].text).toMatch(/^source: tab-capture\n/); expect(r.content[1].text).toContain(TREE);
    await c.close();
  });
  it("rendered: says what could not be drawn", async () => {
    runJson(process.pid); shotSource = "rendered";
    const { c, text } = await open({}); const r = await shot(c, text);
    expect(r.content[1].text).toMatch(/^source: rendered\nnot drawn: video\n/);
    await c.close();
  });
  it("headless: the simulator's screenshot says so", async () => {
    runJson(process.pid);
    const { c, text } = await open({ attach: "never" }); const r = await shot(c, text);
    expect(r.content[0].data).toBe(Buffer.from("headless-bytes").toString("base64"));
    expect(r.content[1].text).toMatch(/^source: headless\n/); expect(r.content[1].text).toContain("Headless");
    await c.close();
  });
});
