// #1148: open_app platform + show starts or reuses a visible `shipvo run` phone, and session tools work on it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { acceptWebSocket } from "../../cli/src/run-ws.js";

const root = resolve(__dirname, "..");
let out = "", work = "", sim: http.Server, host: http.Server, simPort = 0, hostPort = 0;
let seen: { type: string; [k: string]: unknown }[] = [];
const TREE = '- button "Buy" [ref=e1]';
const runFile = () => join(work, "proj", ".shipvo", "run.json");
const writeRun = (platform: string) => { mkdirSync(join(work, "proj", ".shipvo"), { recursive: true }); writeFileSync(runFile(), JSON.stringify({ port: hostPort, platform, app: "menu", token: "tok", pid: process.pid })); };

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  work = mkdtempSync(join(tmpdir(), "attach-show-"));
  mkdirSync(join(work, "proj", "src"), { recursive: true });
  writeFileSync(join(work, "proj", "shipvo.json"), "{}");
  // The fake `shipvo`: records its arguments and writes run.json for the platform it was asked for.
  writeFileSync(join(work, "fake-shipvo.mjs"), `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
appendFileSync(${JSON.stringify(join(work, "spawned.txt"))}, process.argv.slice(2).join(" ") + "\\n");
mkdirSync(".shipvo", { recursive: true });
writeFileSync(".shipvo/run.json", JSON.stringify({ port: Number(process.env.FAKE_PORT), platform: process.argv[3], app: "menu", token: "tok", pid: Number(process.env.FAKE_PID) }));
setTimeout(() => {}, 5000);
`);
  chmodSync(join(work, "fake-shipvo.mjs"), 0o755);
  writeFileSync(join(work, "fake-browser.mjs"), `#!/usr/bin/env node\nimport { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(join(work, "browser.txt"))}, process.argv[2] + "\\n");\n`);
  chmodSync(join(work, "fake-browser.mjs"), 0o755);
  sim = http.createServer(async (req, res) => {
    for await (const _ of req);
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
      if (m.type === "skin") { writeRun(m.platform); return void peer?.send(JSON.stringify({ id: m.id, ok: true })); }
      if (m.type === "device_log") return void peer?.send(JSON.stringify({ id: m.id, ok: true, log: [{ kind: "set", source: "simulated" }, { kind: "net", detail: { url: "https://x/orders", method: "POST" } }], capabilities: { camera: "simulated" }, screen: TREE }));
      peer?.send(JSON.stringify({ id: m.id, ok: true, screen: TREE }));
    }, () => {});
  });
  await Promise.all([new Promise<void>((r) => sim.listen(0, r)), new Promise<void>((r) => host.listen(0, "127.0.0.1", r))]);
  simPort = (sim.address() as { port: number }).port; hostPort = (host.address() as { port: number }).port;
});
afterAll(() => { sim?.close(); host?.close(); if (out) rmSync(out, { recursive: true, force: true }); if (work) rmSync(work, { recursive: true, force: true }); });

async function open(args: Record<string, unknown>) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${simPort}`, PN_CONTROL: "http://127.0.0.1:1", SHIPVO_BIN: join(work, "fake-shipvo.mjs"), SHIPVO_BROWSER: join(work, "fake-browser.mjs"), FAKE_PORT: String(hostPort), FAKE_PID: String(process.pid) };
  delete env.PN_APPS; delete env.CI;
  const c = new Client({ name: "t", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env, cwd: join(work, "proj", "src") }));
  const call = async (name: string, a: Record<string, unknown>) => (await c.callTool({ name, arguments: a }) as { content: { text: string }[]; isError?: boolean }).content[0].text;
  return { c, call, text: await call("open_app", { app: "menu", ...args }) };
}
const reset = () => { seen = []; rmSync(join(work, "proj", ".shipvo"), { recursive: true, force: true }); rmSync(join(work, "spawned.txt"), { force: true }); rmSync(join(work, "browser.txt"), { force: true }); };
const sid = (t: string) => /session: (\S+)/.exec(t)![1];

describe("open_app platform and show", { timeout: 40_000 }, () => {
  it("starts a run for ios when none is live, opens the browser and attaches", async () => {
    reset();
    const { c, text } = await open({ platform: "ios", show: true });
    expect(readFileSync(join(work, "spawned.txt"), "utf8").trim()).toBe("run ios --no-open");
    for (let i = 0; i < 40 && !existsSync(join(work, "browser.txt")); i++) await new Promise((r) => setTimeout(r, 50)); // the opener is detached
    expect(readFileSync(join(work, "browser.txt"), "utf8").trim()).toBe(`http://127.0.0.1:${hostPort}/`);
    expect(text).toContain("attached to the live shipvo run phone");
    expect(text).toContain(`phone: visible at http://127.0.0.1:${hostPort}/ (iOS`);
    await c.close();
  });
  it("switches the skin of a live android run instead of starting a second one", async () => {
    reset(); writeRun("android");
    const { c, text } = await open({ platform: "ios", show: true });
    expect(existsSync(join(work, "spawned.txt"))).toBe(false);
    expect(seen.some((m) => m.type === "skin" && m.platform === "ios")).toBe(true);
    expect(text).toContain("(iOS");
    await c.close();
  });
  it("set_device, device_log and push_notification work attached; the report has the network calls", async () => {
    reset(); writeRun("android");
    const { c, call, text } = await open({ show: true });
    const session = sid(text);
    expect(await call("set_device", { session, payment: { nextResult: "decline" } })).not.toContain("not_supported_attached");
    expect(seen.some((m) => m.type === "set_device" && (m.device as any).payment.nextResult === "decline")).toBe(true);
    const log = JSON.parse(await call("device_log", { session }));
    expect(log.log).toHaveLength(2);
    expect(log.capabilities).toEqual({ camera: "simulated" });
    await call("push_notification", { session, title: "Hi", body: "there" });
    expect(seen.some((m) => m.type === "push_notification" && m.title === "Hi")).toBe(true);
    const report = JSON.parse(await call("end_session", { session }));
    expect(report.mode).toBe("attached");
    expect(report.network).toEqual([{ url: "https://x/orders", method: "POST" }]);
    await c.close();
  });
  it("show false stays headless and starts nothing", async () => {
    reset();
    const { c, text } = await open({ platform: "ios", show: false });
    expect(text).toContain("mode: headless session");
    expect(text).toContain("phone: not visible");
    expect(existsSync(join(work, "spawned.txt"))).toBe(false);
    await c.close();
  });
  it("list_apps says whether a phone is visible", async () => {
    reset(); writeRun("ios");
    const { c, call } = await open({ show: false });
    expect(await call("list_apps", {})).toContain(`visible at http://127.0.0.1:${hostPort}/`);
    await c.close();
  });
});
