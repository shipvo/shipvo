import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = resolve(__dirname, "..");
let out = ""; let fake: http.Server; let proc: ChildProcess; let base = "";
const freePort = () => new Promise<number>((ok) => { const s = http.createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); });

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const sent = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/apps") return res.end(JSON.stringify({ ok: true, apps: [{ id: "menu", name: "Table Menu" }] }));
    if (req.url === "/session") return res.end(JSON.stringify({ ok: true, release: "local", screen: "heading Table Menu" }));
    if (sent.action === "open_url") return res.end(JSON.stringify(sent.url === "myapp://item/3" ? { ok: true, screen: "heading Item 3" } : { ok: false, code: "no_url_listener", error: "the app has no URL listener", screen: "heading Home" }));
    res.end(JSON.stringify({ ok: true, screen: "ok" }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  const simPort = (fake.address() as { port: number }).port;
  const port = await freePort();
  base = `http://127.0.0.1:${port}/mcp`;
  proc = spawn(process.execPath, [join(out, "server.js"), "--http", String(port)], { env: { ...process.env, PN_SIM: `http://127.0.0.1:${simPort}`, PN_CONTROL: "http://127.0.0.1:1", PN_API_KEYS: "", PN_APPS: "" } as any, stdio: "pipe" });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("server did not start");
}, 60000);
afterAll(() => { proc?.kill(); fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

// A 2026-07-28 style request: no session header, no initialize.
async function rpc(method: string, params: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return { status: r.status, sid: r.headers.get("mcp-session-id"), body: (await r.json()) as any };
}

describe("stateless HTTP", () => {
  it("answers tools/list and tools/call with no session and no initialize", async () => {
    const list = await rpc("tools/list", {});
    expect(list.status).toBe(200);
    expect(list.body.result.tools.map((t: any) => t.name)).toContain("open_app");
    expect(list.sid).toBeNull();
    const call = await rpc("tools/call", { name: "open_app", arguments: { app: "menu" } });
    expect(call.status).toBe(200);
    expect(call.body.result.content[0].text).toContain("heading Table Menu");
  });

  it("registers open_url with annotations and shows a typed failure as Error [code]", async () => {
    const tool = (await rpc("tools/list", {})).body.result.tools.find((t: any) => t.name === "open_url");
    expect(tool).toBeTruthy();
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    const opened = await rpc("tools/call", { name: "open_app", arguments: { app: "menu" } });
    expect(opened.body.result.isError).toBeFalsy();
    const session = "s1";
    const ok = await rpc("tools/call", { name: "open_url", arguments: { session, url: "myapp://item/3" } });
    expect(ok.body.result.content[0].text).toContain("heading Item 3");
    const bad = await rpc("tools/call", { name: "open_url", arguments: { session, url: "myapp://other" } });
    expect(bad.body.result.content[0].text).toContain("Error [no_url_listener]");
  });

  it("enforces the scope of each request on its own", async () => {
    const open = { name: "open_app", arguments: { app: "menu" } };
    const owner = await rpc("tools/call", open, { "x-shipvo-scope": "owner" });
    expect(owner.body.result.isError).toBeFalsy();
    const read = await rpc("tools/call", open, { "x-shipvo-scope": "read" });
    expect(read.body.result.isError).toBe(true);
    expect(read.body.result.content[0].text).toContain("read-only");
    const again = await rpc("tools/call", open, { "x-shipvo-scope": "owner" });
    expect(again.body.result.isError).toBeFalsy();
    const cmd = { name: "owner_command", arguments: { app: "menu", command: "x" } };
    expect((await rpc("tools/call", cmd, { "x-shipvo-scope": "test" })).body.result.content[0].text).toContain("owner key");
  });

  it("lists tools in the same order every time", async () => {
    const names = async () => (await rpc("tools/list", {})).body.result.tools.map((t: any) => t.name);
    const first = await names();
    expect(await names()).toEqual(first);
    expect(await names()).toEqual(first);
  });

  it("still serves a 2025-era client (initialize, then calls)", async () => {
    const c = new Client({ name: "old", version: "0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(base)));
    expect((await c.listTools()).tools.length).toBeGreaterThan(5);
    const r: any = await c.callTool({ name: "open_app", arguments: { app: "menu" } });
    expect(r.content[0].text).toContain("heading Table Menu");
    await c.close();
  });

  it("ignores a stale mcp-session-id and refuses GET/DELETE with 405", async () => {
    expect((await rpc("tools/list", {}, { "mcp-session-id": "gone" })).status).toBe(200);
    expect((await fetch(base)).status).toBe(405);
    expect((await fetch(base, { method: "DELETE" })).status).toBe(405);
  });
});
