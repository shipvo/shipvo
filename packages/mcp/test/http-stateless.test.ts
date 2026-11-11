import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = resolve(__dirname, "..");
let out = ""; let fake: http.Server; const simSeen: { url: string; body: any }[] = []; let proc: ChildProcess; let base = "";
const freePort = () => new Promise<number>((ok) => { const s = http.createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); });

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const sent = raw ? JSON.parse(raw) : {};
    simSeen.push({ url: req.url ?? "", body: sent });
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/sessions") return res.end(JSON.stringify({ ok: true, sessions: [{ session: "team-1", app: "tide", release: 31, room: "team-1", skin: "android" }] }));
    if (sent.action === "phone_apps") return res.end(JSON.stringify({ ok: true, current_app: "tide", installed_apps: [{ id: "tide" }, { id: "inbox", kind: "spec" }] }));
    if (sent.action === "switch_app") return res.end(JSON.stringify({ ok: true, screen: "heading Assistant Inbox" }));
    if (req.url === "/phones/export") return res.end(JSON.stringify({ ok: true, format: "shipvo.phones/v0", phones: [{ session: "s1", app: "tide" }] }));
    if (req.url === "/phones/import") return res.end(JSON.stringify({ ok: true, imported: (sent.phones ?? []).map((p: any) => p.session) }));
    if (req.url === "/apps") return res.end(JSON.stringify({ ok: true, apps: [{ id: "menu", name: "Table Menu" }] }));
    if (req.url === "/session") return res.end(JSON.stringify({ ok: true, release: "local", screen: "heading Table Menu" }));
    if (sent.action === "open_url" && sent.url === "plain") return res.end(JSON.stringify({ ok: false, code: "invalid_url", error: "not a URL", screen: "heading Home" }));
    if (sent.action === "open_url" && sent.url === "zzz://x") return res.end(JSON.stringify({ ok: false, code: "no_handler", error: "no installed app handles 'zzz:'", screen: "heading Home" }));
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

  it("shows invalid_url and no_handler from open_url as typed errors", async () => {
    const reg = (await rpc("tools/list", {})).body.result.tools.find((t: any) => t.name === "open_url");
    expect(reg.description).toContain("no_handler");
    await rpc("tools/call", { name: "open_app", arguments: { app: "menu" } });
    const a = await rpc("tools/call", { name: "open_url", arguments: { session: "s1", url: "plain" } });
    expect(a.body.result.content[0].text).toContain("Error [invalid_url]");
    const b = await rpc("tools/call", { name: "open_url", arguments: { session: "s1", url: "zzz://x" } });
    expect(b.body.result.content[0].text).toContain("Error [no_handler]");
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

  it("sorts tools/list by name", async () => {
    const names = (await rpc("tools/list", {})).body.result.tools.map((t: any) => t.name);
    expect(names).toEqual([...names].sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it("adds ttlMs, cacheScope and resultType for 2026 requests only", async () => {
    const r26 = (await rpc("tools/list", {}, { "mcp-method": "tools/list" })).body.result;
    expect(typeof r26.ttlMs).toBe("number");
    expect(r26.cacheScope).toBe("private");
    expect(r26.resultType).toBe("complete");
    const call = await rpc("tools/call", { name: "open_app", arguments: { app: "menu" } }, { "mcp-method": "tools/call", "mcp-name": "open_app" });
    expect(call.body.result.resultType).toBe("complete");
    const r25 = (await rpc("tools/list", {})).body.result;
    expect(r25.ttlMs).toBeUndefined();
    expect(r25.cacheScope).toBeUndefined();
    expect(r25.resultType).toBeUndefined();
  });

  it("uses -32020 for header mismatch and -32022 for an unsupported version", async () => {
    const m = await rpc("tools/list", {}, { "mcp-method": "tools/call" });
    expect(m.body.error.code).toBe(-32020);
    const v = await rpc("tools/list", { _meta: { "io.modelcontextprotocol/protocolVersion": "2027-01-01" } }, { "mcp-method": "tools/list" });
    expect(v.status).toBe(400);
    expect(v.body.error.code).toBe(-32022);
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

  it("answers server/discover with no initialize", async () => {
    const r = await rpc("server/discover", {}, { "mcp-method": "server/discover" });
    expect(r.status).toBe(200);
    expect(r.body.result.supportedVersions).toContain("2026-07-28");
    expect(r.body.result.supportedVersions).toContain("2025-06-18");
    expect(r.body.result.capabilities.tools).toBeTruthy();
    expect(r.body.result.serverInfo.name).toBe("shipvo");
    expect(r.sid).toBeNull();
  });

  it("rejects Mcp-Method/Mcp-Name headers that disagree with the body", async () => {
    const call = { name: "open_app", arguments: { app: "menu" } };
    const ok = await rpc("tools/call", call, { "mcp-method": "tools/call", "mcp-name": "open_app" });
    expect(ok.body.result.content[0].text).toContain("heading Table Menu");
    const m = await rpc("tools/call", call, { "mcp-method": "tools/list" });
    expect(m.status).toBe(400);
    expect(m.body.error.message).toContain("Mcp-Method");
    expect(m.body.result).toBeUndefined();
    const n = await rpc("tools/call", call, { "mcp-method": "tools/call", "mcp-name": "tap" });
    expect(n.status).toBe(400);
    expect(n.body.error.message).toContain("Mcp-Name");
    expect((await rpc("tools/call", call, { "mcp-method": "tools/call" })).status).toBe(400);
  });

  it("requires the headers when the body names a 2026 protocol version", async () => {
    const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };
    expect((await rpc("tools/list", { _meta: meta })).status).toBe(400);
    expect((await rpc("tools/list", { _meta: meta }, { "mcp-method": "tools/list" })).status).toBe(200);
  });
});

describe("moving phones (hosted service only)", () => {
  const phones = (path: string, token?: string, body?: unknown) => fetch(base.replace("/mcp", path), { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) });
  const A = "a".repeat(64), B = "b".repeat(64);
  it("export and import answer nothing before the sandbox is claimed", async () => {
    expect((await phones("/phones/export", A)).status).toBe(404);
    expect((await phones("/phones/export")).status).toBe(404);
  });
  it("one claim; then only the claimer's token exports and imports", async () => {
    expect((await phones("/phones/claim", "short")).status).toBe(404);
    expect((await phones("/phones/claim", A)).status).toBe(200);
    expect((await phones("/phones/claim", A)).status).toBe(200);          // the same token again is fine
    expect((await phones("/phones/claim", B)).status).toBe(409);          // nobody else can take it over
    expect((await phones("/phones/export", B)).status).toBe(404);
    const ex = await phones("/phones/export", A);
    expect(ex.status).toBe(200); expect((await ex.json() as any).phones[0].app).toBe("tide");
    const im = await phones("/phones/import", A, { format: "shipvo.phones/v0", phones: [{ session: "s1", app: "tide" }] });
    expect((await im.json() as any).imported).toEqual(["s1"]);
    expect((await fetch(base.replace("/mcp", "/phones/export"), { headers: { authorization: `Bearer ${A}` } })).status).toBe(404);   // POST only
  });
});

describe("an open session shared by assistants", () => {
  const call = async (name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) =>
    (await rpc("tools/call", { name, arguments: args }, headers)).body.result;
  it("open_app reuses an open session instead of starting it over, and switches to the app", async () => {
    simSeen.length = 0;
    const r = await call("open_app", { app: "menu", session: "team-1" });
    expect(r.content[0].text).toContain("not_installed");                 // "menu" is not on that phone: nothing is reset
    expect(simSeen.some((s) => s.url === "/session")).toBe(false);
    simSeen.length = 0;
    const ok = await call("open_app", { app: "inbox", session: "team-1" });
    expect(ok.content[0].text).toMatch(/^session: team-1\napp: inbox release: 31\nmode: reused the open session/);
    expect(simSeen.find((s) => s.body.action === "switch_app")?.body.id).toBe("inbox");
    expect(simSeen.some((s) => s.url === "/session")).toBe(false);
  });
  it("restart: true starts the session over", async () => {
    simSeen.length = 0;
    await call("open_app", { app: "menu", session: "team-1", restart: true });
    expect(simSeen.some((s) => s.url === "/session" && s.body.session === "team-1")).toBe(true);
  });
  it("names the assistant from x-shipvo-client when a tool call carries no client name", async () => {
    simSeen.length = 0;
    await call("tap", { session: "team-1", ref: "e1" }, { "x-shipvo-client": "Gemini" });
    expect(simSeen.find((s) => s.url === "/act")?.body.agent).toBe("Gemini");
  });
});
