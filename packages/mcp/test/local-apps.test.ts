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
const posts: string[] = [];

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  // a stand-in simulator that serves the scaffolded app "menu"
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    posts.push(req.url ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/apps") return res.end(JSON.stringify({ ok: true, apps: [{ id: "menu", name: "Table Menu" }] }));
    if (req.url === "/session") return res.end(JSON.stringify({ ok: true, app: "menu", release: "local", screen: "heading Table Menu" }));
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
const textOf = (r: any) => r.content[0].text as string;

describe("local mcp", () => {
  it("opens the app the simulator serves, with no PN_APPS", async () => {
    const c = await connect();
    expect(textOf(await c.callTool({ name: "list_apps", arguments: {} }))).toContain('menu: Table Menu');
    const r = await c.callTool({ name: "open_app", arguments: { app: "menu" } });
    expect(textOf(r)).toContain("app: menu");
    expect(posts).toContain("/session");
    await c.close();
  });
  it("still rejects an app the simulator does not serve", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "open_app", arguments: { app: "nope" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("Apps: menu");
    await c.close();
  });
});
