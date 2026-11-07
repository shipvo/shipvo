import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { spawn, type ChildProcess } from "node:child_process";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const server = resolve(__dirname, "..", "dist", "server.js");
// Stand-in for the hosted service: keys map to accounts, builds belong to one account and expire.
const accounts: Record<string, string> = { "key-a": "acct-a", "key-b": "acct-b" };
const builds = new Map<string, { account: string; app: string; expires: number; bytes: number }>();
let simLoadsBuilds = true; let now = Date.now(); let limit = 1 << 20; let seq = 0;
let hosted: http.Server; let sim: http.Server; let hostedPort = 0; let simPort = 0; let proj = "";
const sessionBodies: any[] = [];

const listen = (s: http.Server) => new Promise<number>((ok) => s.listen(0, "127.0.0.1", () => ok((s.address() as { port: number }).port)));
beforeAll(async () => {
  hosted = http.createServer(async (req, res) => {
    const send = (c: number, o: unknown) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    const acct = accounts[(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "")];
    if (!acct) return send(401, { code: "invalid_api_key", error: "invalid key" });
    const u = new URL(req.url ?? "/", "http://x");
    if (req.method === "POST" && u.pathname === "/builds") {
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
      const n = Buffer.concat(chunks).length;
      if (n > limit) return send(413, { code: "build_too_large", error: `the build is ${n} bytes, over the size limit` });
      const id = `b${++seq}`; builds.set(id, { account: acct, app: u.searchParams.get("app")!, expires: now + 3600_000, bytes: n });
      return send(201, { id, app: u.searchParams.get("app"), expires_at: new Date(now + 3600_000).toISOString() });
    }
    const m = /^\/builds\/([\w-]+)$/.exec(u.pathname);
    if (req.method === "GET" && m) {
      const b = builds.get(m[1]);
      if (!b || b.account !== acct) return send(404, { code: "build_not_found", error: "no such build" });
      if (b.expires <= now) { builds.delete(m[1]); return send(410, { code: "build_expired", error: "expired" }); }
      return send(200, { id: m[1], app: b.app, expires_at: new Date(b.expires).toISOString(), url: `http://127.0.0.1:${hostedPort}/files/${m[1]}/` });
    }
    send(404, {});
  });
  hostedPort = await listen(hosted);
  sim = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = req.url === "/session" ? JSON.parse(raw) : {};
    if (req.url === "/session") sessionBodies.push(body);
    res.writeHead(200, { "content-type": "application/json" });
    // A simulator that supports builds echoes the build it loaded; one that does not ignores build_url.
    const build = simLoadsBuilds && body.build_url ? String(body.build_url).split("/files/")[1]?.replace(/\/$/, "") : undefined;
    res.end(JSON.stringify({ ok: true, screen: "heading Hello from my build", release: "local", ...(build ? { build } : {}) }));
  });
  simPort = await listen(sim);
  proj = mkdtempSync(join(tmpdir(), "hosted-build-"));
  mkdirSync(join(proj, "sim-dist"));
  writeFileSync(join(proj, "sim-dist", "index.html"), "<html>my uncommitted change</html>");
  writeFileSync(join(proj, "shipvo.json"), JSON.stringify({ appId: "myapp" }));
});
afterAll(() => { hosted?.close(); sim?.close(); rmSync(proj, { recursive: true, force: true }); });

async function client(key: string) {
  const c = new Client({ name: "t", version: "1" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env, PN_SIM: `http://127.0.0.1:${simPort}`, PN_CONTROL: "http://127.0.0.1:1", PN_APPS: JSON.stringify({ myapp: { name: "My app", description: "x" }, otherapp: { name: "Other", description: "x" } }), SHIPVO_HOSTED_URL: `http://127.0.0.1:${hostedPort}`, SHIPVO_API_KEY: key } as Record<string, string> }));
  return c;
}
const txt = (r: any) => r.content[0].text as string;

describe("test the build on your machine on the hosted phone", () => {
  it("uploads a build and opens it by id", async () => {
    const a = await client("key-a");
    const up: any = await a.callTool({ name: "upload_build", arguments: { dir: proj, skip_build: true } });
    expect(up.isError).toBeFalsy();
    const id = up.structuredContent.id as string;
    expect(up.structuredContent.app).toBe("myapp");
    expect(up.structuredContent.expires_at).toBeTruthy();
    const open: any = await a.callTool({ name: "open_app", arguments: { app: `myapp@build:${id}` } });
    expect(open.isError).toBeFalsy();
    expect(txt(open)).toContain(`build:${id}`);
    expect(sessionBodies.at(-1).build_url).toBe(`http://127.0.0.1:${hostedPort}/files/${id}/`);
    await a.close();
  }, 30000);

  it("refuses a build uploaded for another app", async () => {
    const a = await client("key-a");
    const id = (await a.callTool({ name: "upload_build", arguments: { dir: proj, skip_build: true } }) as any).structuredContent.id;
    const r: any = await a.callTool({ name: "open_app", arguments: { app: `otherapp@build:${id}` } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.code).toBe("build_not_found");
    await a.close();
  }, 30000);

  it("does not report a build as open when the simulator did not load it", async () => {
    simLoadsBuilds = false;
    const a = await client("key-a");
    const id = (await a.callTool({ name: "upload_build", arguments: { dir: proj, skip_build: true } }) as any).structuredContent.id;
    const r: any = await a.callTool({ name: "open_app", arguments: { app: `myapp@build:${id}` } });
    simLoadsBuilds = true;
    expect(r.isError).toBe(true);
    expect(r.structuredContent.code).toBe("build_not_supported");
    expect(txt(r)).not.toContain(`release: build:${id}`);
    await a.close();
  }, 30000);

  it("does not let another account's key open the build", async () => {
    const a = await client("key-a"); const b = await client("key-b");
    const id = (await a.callTool({ name: "upload_build", arguments: { dir: proj, skip_build: true } }) as any).structuredContent.id;
    const r: any = await b.callTool({ name: "open_app", arguments: { app: `myapp@build:${id}` } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.code).toBe("build_not_found");
    await a.close(); await b.close();
  }, 30000);

  it("answers build_expired once the build has expired", async () => {
    const a = await client("key-a");
    const id = (await a.callTool({ name: "upload_build", arguments: { dir: proj, skip_build: true } }) as any).structuredContent.id;
    now += 2 * 3600_000;
    const r: any = await a.callTool({ name: "open_app", arguments: { app: `myapp@build:${id}` } });
    expect(r.structuredContent.code).toBe("build_expired");
    expect(txt(r)).toContain("upload_build");
    await a.close();
  }, 30000);

  it("says how to make a too-large build smaller", async () => {
    limit = 10;
    const a = await client("key-a");
    const r: any = await a.callTool({ name: "upload_build", arguments: { dir: proj, skip_build: true } });
    limit = 1 << 20;
    expect(r.structuredContent.code).toBe("build_too_large");
    expect(txt(r)).toMatch(/make it smaller/);
    await a.close();
  }, 30000);

  it("asks for a key when none is set", async () => {
    const a = await client("");
    const r: any = await a.callTool({ name: "upload_build", arguments: { dir: proj, skip_build: true } });
    expect(r.structuredContent.code).toBe("no_api_key");
    await a.close();
  }, 30000);
});

// The hosted phone: the Worker verifies the key and passes it as x-shipvo-key (and the scope as x-shipvo-scope).
describe("hosted HTTP server", () => {
  let proc: ChildProcess; let base = "";
  beforeAll(async () => {
    const probe = http.createServer(); const port = await listen(probe); await new Promise((r) => probe.close(r));
    base = `http://127.0.0.1:${port}`;
    proc = spawn(process.execPath, [server, "--http", String(port)], { env: { ...process.env, PN_SIM: `http://127.0.0.1:${simPort}`, PN_CONTROL: "http://127.0.0.1:1", PN_APPS: JSON.stringify({ myapp: { name: "My app", description: "x" } }), SHIPVO_HOSTED_URL: `http://127.0.0.1:${hostedPort}`, SHIPVO_API_KEY: "" } as Record<string, string>, stdio: "pipe" });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/health`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    throw new Error("server did not start");
  }, 30000);
  afterAll(() => { proc?.kill(); });
  const call = async (name: string, args: unknown, headers: Record<string, string>) => {
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    return ((await r.json()) as any).result;
  };
  const upload = async () => (await (async () => { const a = await client("key-a"); const r: any = await a.callTool({ name: "upload_build", arguments: { dir: proj, skip_build: true } }); await a.close(); return r; })()).structuredContent.id as string;

  it("opens a build with the key the Worker passes in x-shipvo-key", async () => {
    const id = await upload();
    const r = await call("open_app", { app: `myapp@build:${id}` }, { "x-shipvo-key": "key-a", "x-shipvo-app": "myapp", "x-shipvo-scope": "test" });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain(`build:${id}`);
  }, 30000);

  it("does not find the build with another account's key", async () => {
    const id = await upload();
    const r = await call("open_app", { app: `myapp@build:${id}` }, { "x-shipvo-key": "key-b", "x-shipvo-app": "myapp", "x-shipvo-scope": "test" });
    expect(r.structuredContent.code).toBe("build_not_found");
  }, 30000);

  it("refuses upload_build for a read-only key", async () => {
    const r = await call("upload_build", { dir: proj }, { "x-shipvo-key": "key-a", "x-shipvo-app": "myapp", "x-shipvo-scope": "read" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/read-only/);
  }, 30000);

  it("answers stdio_only for upload_build on the hosted server", async () => {
    const r = await call("upload_build", { dir: proj }, { "x-shipvo-key": "key-a", "x-shipvo-app": "myapp", "x-shipvo-scope": "test" });
    expect(r.structuredContent.code).toBe("stdio_only");
  }, 30000);
});
