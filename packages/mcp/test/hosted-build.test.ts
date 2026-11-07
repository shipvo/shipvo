import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, delimiter } from "node:path";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(__dirname, "..");
let out = ""; let hosted: http.Server; let hostedPort = 0; let sim: http.Server; let simPort = 0;
let project = ""; let bin = "";
const sessions: any[] = [];
// The stand-in hosted service: two accounts, builds private to the account, a size limit and an expiry.
const KEYS: Record<string, string> = { "key-a": "a", "key-b": "b" };
const builds = new Map<string, { account: string; app: string; expires_at: string }>();
let maxBytes = 1e9;

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  hosted = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const send = (s: number, o: unknown) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    const account = KEYS[String(req.headers.authorization ?? "").replace("Bearer ", "")];
    if (!account) return send(401, { error: "invalid_api_key" });
    const u = new URL(req.url!, "http://x");
    if (req.method === "POST" && u.pathname === "/builds") {
      const size = Buffer.concat(chunks).length;
      if (size > maxBytes) return send(413, { code: "build_too_large", message: "the build is too large. Make it smaller: remove unused images, fonts and packages." });
      const id = "b" + builds.size; builds.set(id, { account, app: u.searchParams.get("app")!, expires_at: new Date(Date.now() + 3600e3).toISOString() });
      return send(201, { id, expires_at: builds.get(id)!.expires_at, bytes: size });
    }
    const m = /^\/builds\/(\w+)$/.exec(u.pathname); const row = m && builds.get(m[1]);
    if (!row || row.account !== account) return send(404, { code: "build_not_found" });
    if (row.expires_at < new Date().toISOString()) return send(410, { code: "build_expired" });
    send(200, { id: m![1], app: row.app, expires_at: row.expires_at });
  });
  sim = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/session") { sessions.push(JSON.parse(raw)); return res.end(JSON.stringify({ ok: true, release: "build", screen: "heading Uncommitted change" })); }
    res.end(JSON.stringify({ ok: true, apps: [{ id: "menu" }] }));
  });
  await Promise.all([new Promise<void>((r) => hosted.listen(0, r)), new Promise<void>((r) => sim.listen(0, r))]);
  hostedPort = (hosted.address() as { port: number }).port; simPort = (sim.address() as { port: number }).port;
  // A project, and an `npx` that stands in for `expo export` by writing a web build.
  project = mkdtempSync(join(tmpdir(), "hb-proj-")); bin = mkdtempSync(join(tmpdir(), "hb-bin-"));
  writeFileSync(join(project, "shipvo.json"), JSON.stringify({ appId: "menu" }));
  writeFileSync(join(bin, "npx"), '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "--output-dir" ] && d="$2"; shift; done\nmkdir -p "$d" && echo "<html>build</html>" > "$d/index.html"\n');
  chmodSync(join(bin, "npx"), 0o755);
});
afterAll(() => { hosted?.close(); sim?.close(); for (const d of [out, project, bin]) if (d) rmSync(d, { recursive: true, force: true }); });

async function connect(key: string) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${simPort}`, PN_CONTROL: "http://127.0.0.1:1", SHIPVO_HOSTED_URL: `http://localhost:${hostedPort}`, SHIPVO_API_KEY: key, PATH: bin + delimiter + process.env.PATH };
  delete env.PN_APPS;
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env, cwd: project }));
  return c;
}
const textOf = (r: any) => r.content[0].text as string;

describe("upload_build and app@build:<id>", () => {
  it("uploads the build and opens it on the phone", async () => {
    const c = await connect("key-a");
    const up: any = await c.callTool({ name: "upload_build", arguments: {} });
    expect(up.isError).toBeFalsy();
    const id = /build: (\w+)/.exec(textOf(up))![1];
    expect(textOf(up)).toMatch(/expires: \d{4}-/);
    expect(builds.get(id)).toMatchObject({ account: "a", app: "menu" });
    const r: any = await c.callTool({ name: "open_app", arguments: { app: `menu@build:${id}` } });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain("Uncommitted change");
    expect(sessions.at(-1).app).toBe(`menu@build:${id}`);
    await c.close();
  }, 60000);

  it("another account's key cannot open the build", async () => {
    const a = await connect("key-a");
    const id = /build: (\w+)/.exec(textOf(await a.callTool({ name: "upload_build", arguments: {} })))![1];
    await a.close();
    const n = sessions.length;
    const b = await connect("key-b");
    const r: any = await b.callTool({ name: "open_app", arguments: { app: `menu@build:${id}` } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("[build_not_found]");
    expect(sessions.length).toBe(n);
    await b.close();
  }, 60000);

  it("an expired build answers build_expired", async () => {
    const c = await connect("key-a");
    const id = /build: (\w+)/.exec(textOf(await c.callTool({ name: "upload_build", arguments: {} })))![1];
    builds.get(id)!.expires_at = new Date(Date.now() - 1000).toISOString();
    const r: any = await c.callTool({ name: "open_app", arguments: { app: `menu@build:${id}` } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("[build_expired]");
    expect(textOf(r)).toMatch(/upload_build again/);
    await c.close();
  }, 60000);

  it("a build over the size limit says how to make it smaller", async () => {
    maxBytes = 1;
    try {
      const c = await connect("key-a");
      const r: any = await c.callTool({ name: "upload_build", arguments: {} });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain("[build_too_large]");
      expect(textOf(r)).toMatch(/smaller/);
      await c.close();
    } finally { maxBytes = 1e9; }
  }, 60000);

  it("says no_api_key without a key", async () => {
    const c = await connect("");
    const r: any = await c.callTool({ name: "upload_build", arguments: {} });
    expect(textOf(r)).toContain("[no_api_key]");
    await c.close();
  }, 60000);
});
