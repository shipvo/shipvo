import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describeTools } from "@shipvo/mcp-tools";

// The built server (pnpm build runs before pnpm test in CI). Stdio is the coding-agent server, --http the remote one.
const server = resolve(__dirname, "..", "dist", "server.js");
const freePort = () => new Promise<number>((ok) => { const s = http.createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); });
const env = { ...process.env, PN_SIM: "http://127.0.0.1:1", PN_CONTROL: "http://127.0.0.1:1", PN_API_KEYS: "", PN_APPS: "" } as Record<string, string>;
type Tool = { name: string; description?: string; inputSchema: unknown; annotations?: unknown };
let stdio: Tool[] = []; let remote: Tool[] = []; let proc: ChildProcess;

beforeAll(async () => {
  const c = new Client({ name: "parity", version: "1" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [server], env }));
  stdio = (await c.listTools()).tools as Tool[];
  await c.close();
  const port = await freePort();
  proc = spawn(process.execPath, [server, "--http", String(port)], { env, stdio: "pipe" });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const h = new Client({ name: "parity", version: "1" });
  await h.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  remote = (await h.listTools()).tools as Tool[];
  await h.close();
}, 60000);
afterAll(() => { proc?.kill(); });

describe("one tool registry for the stdio and remote servers", () => {
  it("lists the same tools, schemas and hints on both", () => {
    expect(stdio.length).toBeGreaterThan(50);
    expect(remote.map((t) => t.name)).toEqual(stdio.map((t) => t.name));
    expect(remote).toEqual(stdio);
  });

  it("matches the registry: names, descriptions, input schemas and hints", () => {
    const reg = describeTools();
    expect(stdio.map((t) => t.name)).toEqual(reg.map((t) => t.name));
    for (const r of reg) {
      const t = stdio.find((x) => x.name === r.name)!;
      expect(t.description, r.name).toBe(r.description);
      expect(t.inputSchema, r.name).toEqual(r.inputSchema);
      expect(t.annotations, r.name).toEqual(r.annotations);
    }
  });

  it("keeps error codes and approval steps in the registry only, so both servers share them", () => {
    const reg = describeTools();
    expect(reg.find((t) => t.name === "owner_command")).toMatchObject({ needsApproval: true, errorCodes: expect.arrayContaining(["needs_confirm"]) });
    expect(reg.find((t) => t.name === "open_url")?.errorCodes).toContain("no_url_listener");
  });
});
