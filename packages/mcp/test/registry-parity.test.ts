import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync } from "node:fs";
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

  it("lists tools sorted by name, the same on every call and on both servers", () => {
    const names = stdio.map((t) => t.name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(remote.map((t) => t.name)).toEqual(names);
  });

  it("matches the registry: names, descriptions, input schemas and hints", () => {
    const reg = describeTools().sort((a, b) => (a.name < b.name ? -1 : 1));
    expect(stdio.map((t) => t.name)).toEqual(reg.map((t) => t.name));
    for (const r of reg) {
      const t = stdio.find((x) => x.name === r.name)!;
      expect(t.description, r.name).toBe(r.description);
      expect(t.inputSchema, r.name).toEqual(r.inputSchema);
      expect(t.annotations, r.name).toEqual(r.annotations);
    }
  });

  it("has error codes and an approval flag on every registry tool", () => {
    // Error codes and needsApproval are not in the MCP tool list, so a server cannot show them differently.
    // Both servers register handlers from the same registry entries; this pins the shape of every entry.
    const reg = describeTools();
    for (const r of reg) {
      expect(Array.isArray(r.errorCodes), r.name).toBe(true);
      for (const c of r.errorCodes) expect(c, r.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(typeof r.needsApproval, r.name).toBe("boolean");
    }
    expect(reg.filter((t) => t.needsApproval).map((t) => t.name)).toEqual(["owner_command"]);
  });

  it("keeps error codes and approval steps in the registry only, so both servers share them", () => {
    const reg = describeTools();
    expect(reg.find((t) => t.name === "owner_command")).toMatchObject({ needsApproval: true, errorCodes: expect.arrayContaining(["needs_confirm"]) });
    expect(reg.find((t) => t.name === "open_url")?.errorCodes).toContain("no_url_listener");
  });
});

describe("key-shaped input is refused on stdio and remote", () => {
  const key = "sk_" + "live_" + "abcdefghijklmnop1234567890";
  const call = async (c: Client) => { const r: any = await c.callTool({ name: "list_apps", arguments: { query: key } }); return r; };
  const check = (r: any) => {
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r)).not.toContain(key);
    expect(r.content[0].text).toMatch(/rotate/);
    expect(r.content[0].text).toMatch(/request_secret/);
  };
  it("stdio", async () => {
    const c = new Client({ name: "guard", version: "1" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [server], env }));
    check(await call(c)); await c.close();
  }, 30000);
  it("remote", async () => {
    const port = await freePort();
    const p = spawn(process.execPath, [server, "--http", String(port)], { env, stdio: "pipe" });
    try {
      for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
      const c = new Client({ name: "guard", version: "1" });
      await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
      check(await call(c)); await c.close();
    } finally { p.kill(); }
  }, 30000);
});

// Readable diff of two tool lists, by name: missing, extra and changed (name, description, input schema, annotations).
export function diffTools(a: Tool[], b: Tool[], labelA = "stdio", labelB = "remote"): string[] {
  const by = (l: Tool[]) => new Map(l.map((t) => [t.name, t]));
  const ma = by(a), mb = by(b), out: string[] = [];
  for (const n of [...new Set([...ma.keys(), ...mb.keys()])].sort()) {
    const x = ma.get(n), y = mb.get(n);
    if (!x) out.push(`${n}: only on ${labelB}`);
    else if (!y) out.push(`${n}: only on ${labelA}`);
    else for (const k of ["description", "inputSchema", "annotations"] as const) {
      if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push(`${n}.${k}: ${labelA}=${JSON.stringify(x[k])} ${labelB}=${JSON.stringify(y[k])}`);
    }
  }
  return out;
}

describe("parity diff helper", () => {
  const t = (name: string, extra: Partial<Tool> = {}): Tool => ({ name, description: "d", inputSchema: { type: "object" }, annotations: { readOnlyHint: true }, ...extra });
  it("is empty for equal lists", () => expect(diffTools([t("a"), t("b")], [t("b"), t("a")])).toEqual([]));
  it("names a tool added on one side only", () => expect(diffTools([t("a")], [t("a"), t("b")])).toEqual(["b: only on remote"]));
  it("names a changed schema or annotation", () => {
    const d = diffTools([t("a")], [t("a", { inputSchema: { type: "string" }, annotations: { readOnlyHint: false } })]);
    expect(d.map((l) => l.split(":")[0])).toEqual(["a.inputSchema", "a.annotations"]);
  });
});

describe("hosted worker handshake list", () => {
  it("services/sim/src/tools.json matches the stdio list (regenerate it if this fails)", () => {
    const file = JSON.parse(readFileSync(resolve(__dirname, "..", "..", "..", "services", "sim", "src", "tools.json"), "utf8")) as Tool[];
    expect(diffTools(stdio, file, "stdio", "tools.json")).toEqual([]);
  });
});
