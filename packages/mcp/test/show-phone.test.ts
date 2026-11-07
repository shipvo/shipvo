import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
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
  it("a live android run is attached as it is when ios is asked, and nothing is duplicated", async () => {
    seen.length = 0;
    const { c, text, project } = await open({ platform: "ios" }, runJson("android"));
    expect(existsSync(join(project, "started-ios"))).toBe(false);
    expect(seen.some((m) => m.type === "skin")).toBe(false);
    expect(text).toContain("the live phone is android; to see ios");
    expect(text).toContain("visible: yes, android phone");
    await c.close();
  });
  it("tools the run does not answer say not_supported_attached", async () => {
    seen.length = 0;
    const { c, text } = await open({}, runJson("android"));
    const session = /session: (\S+)/.exec(text)![1];
    const sd = await c.callTool({ name: "set_device", arguments: { session, network: "offline" } }) as { content: { text: string }[] };
    expect(sd.content[0].text).toContain("not_supported_attached");
    expect(seen.some((m) => m.type === "set_device")).toBe(false);
    await c.close();
  });
  it("refuses when the project's run is for another app", async () => {
    const { c, text, project } = await open({ app: "other", show: true });
    expect(existsSync(join(project, "started-android"))).toBe(true);
    expect(text).toContain("unknown_app");
    expect(text).toContain('project runs "menu", not "other"');
    await c.close();
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
