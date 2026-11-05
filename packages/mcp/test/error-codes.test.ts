import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(__dirname, "..");
let out = ""; let fake: http.Server; let port = 0;

// A stand-in simulator that knows one session ("live"). For anything else it fails the way a simulator
// would, but with no `code` for some actions, so the test shows what the MCP server does with that.
beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/apps") return res.end(JSON.stringify({ ok: true, apps: [{ id: "menu", name: "Table Menu" }] }));
    if (req.url === "/act" && body.session !== "live") return res.end(JSON.stringify({ ok: false, error: `no session '${body.session}': call /session first` }));
    if (req.url === "/act" && body.ref === "e999") return res.end(JSON.stringify({ ok: false, error: "stale ref e999" }));
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
});
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

async function connect() {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${port}`, PN_CONTROL: "http://127.0.0.1:1" };
  delete env.PN_APPS;
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
  return c;
}

const SESSION_TOOLS: [string, Record<string, unknown>][] = [
  ["screen", {}], ["tap", { ref: "e1" }], ["type", { ref: "e1", text: "x" }], ["scroll", { direction: "down" }], ["back", {}],
  ["screenshot", {}], ["set_device", { online: false }], ["push_notification", { title: "t", body: "b" }], ["notifications", {}],
  ["open_notification", {}], ["open_url", { url: "myapp://x" }], ["device_log", {}], ["device_reset", {}], ["end_session", {}],
];

function expectTyped(r: any) {
  expect(r.isError).toBe(true);
  expect(typeof r.structuredContent?.code).toBe("string");
  expect(r.structuredContent.code).not.toBe("");
  expect(typeof r.structuredContent.error).toBe("string");
  expect(r.structuredContent.error.length).toBeGreaterThan(0);
  expect(r.content[0].text).toContain(`[${r.structuredContent.code}]`);
}

describe("typed error codes", () => {
  it("every session tool returns a typed code for an unknown session", async () => {
    const c = await connect();
    const listed = (await c.listTools()).tools.map((t) => t.name);
    for (const [name, args] of SESSION_TOOLS) {
      expect(listed).toContain(name);
      expectTyped(await c.callTool({ name, arguments: { session: "ghost", ...args } }));
    }
    await c.close();
  });
  it("covers every tool that takes a session", async () => {
    const c = await connect();
    const withSession = (await c.listTools()).tools.filter((t) => (t.inputSchema.properties as any)?.session && t.name !== "open_app").map((t) => t.name);
    expect(withSession.sort()).toEqual(SESSION_TOOLS.map(([n]) => n).sort());
    await c.close();
  });
  it("tap with a ref that does not exist is typed", async () => {
    const c = await connect();
    expectTyped(await c.callTool({ name: "tap", arguments: { session: "live", ref: "e999" } }));
    await c.close();
  });
  it("open_app with an unknown app is typed unknown_app", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "open_app", arguments: { app: "nope" } });
    expectTyped(r);
    expect(r.structuredContent.code).toBe("unknown_app");
    await c.close();
  });
  it("a simulator that is not running gives sim_unreachable", async () => {
    const c = new Client({ name: "test", version: "0" });
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: "http://127.0.0.1:1", PN_CONTROL: "http://127.0.0.1:1" };
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
    const r: any = await c.callTool({ name: "screen", arguments: { session: "s" } });
    expectTyped(r);
    expect(r.structuredContent.code).toBe("sim_unreachable");
    await c.close();
  });
});
