import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const server = resolve(__dirname, "..", "dist", "server.js");
const bodies: any[] = [];
let sim: http.Server; let proc: ChildProcess; let env: Record<string, string>; let port = 0; let cwd = "";
const listen = (s: http.Server) => new Promise<number>((ok) => s.listen(0, "127.0.0.1", () => ok((s.address() as { port: number }).port)));
const txt = (r: any) => r.content[0].text as string;

beforeAll(async () => {
  sim = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    if (req.url === "/session") bodies.push(JSON.parse(raw));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, screen: "heading Hello", release: "local" }));
  });
  const simPort = await listen(sim);
  cwd = mkdtempSync(resolve(tmpdir(), "open-app-platform-"));
  env = { ...process.env, PN_SIM: `http://127.0.0.1:${simPort}`, PN_CONTROL: "http://127.0.0.1:1", PN_API_KEYS: "", PN_APPS: JSON.stringify({ myapp: { name: "My app", description: "x" } }) } as Record<string, string>;
  const s = http.createServer().listen(0); port = (s.address() as { port: number }).port; await new Promise((r) => s.close(r));
  proc = spawn(process.execPath, [server, "--http", String(port)], { env, cwd, stdio: "pipe" });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
}, 60000);
afterAll(() => { proc?.kill(); sim?.close(); rmSync(cwd, { recursive: true, force: true }); });

describe("open_app platform", () => {
  it("hosted: platform ios reaches the simulator as skin and is not reported as ignored", async () => {
    const c = new Client({ name: "t", version: "1" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    bodies.length = 0;
    const r: any = await c.callTool({ name: "open_app", arguments: { app: "myapp", platform: "ios" } });
    expect(r.isError).toBeFalsy();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].skin).toBe("ios");
    expect(txt(r)).not.toMatch(/platform .* ignored/);
    await c.close();
  });
  it("hosted: without platform no skin is sent", async () => {
    const c = new Client({ name: "t", version: "1" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    bodies.length = 0;
    await c.callTool({ name: "open_app", arguments: { app: "myapp" } });
    expect(bodies[0].skin).toBeUndefined();
    await c.close();
  });
  it("local: platform is not sent as skin and is reported as ignored", async () => {
    const c = new Client({ name: "t", version: "1" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [server], env, cwd }));
    bodies.length = 0;
    const r: any = await c.callTool({ name: "open_app", arguments: { app: "myapp", platform: "ios" } });
    expect(r.isError).toBeFalsy();
    expect(bodies[0].skin).toBeUndefined();
    expect(txt(r)).toMatch(/platform ios ignored/);
    await c.close();
  });
});
