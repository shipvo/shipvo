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
const urls: string[] = [];
const ROWS = Array.from({ length: 300 }, (_, i) => ({ id: 300 - i, app_id: "tide", at: `2026-11-0${1 + (i % 5)}`, actor: "agent", actor_kind: "agent", action: i % 3 === 0 ? "rollback" : "publish", release: `r${300 - i}`, release_id: 300 - i, before: null, after: null }));

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer((req, res) => {
    urls.push(req.url!);
    const u = new URL(req.url!, "http://x");
    if (req.headers.authorization !== "Bearer good") { res.writeHead(401); return res.end(JSON.stringify({ error: "unauthorized" })); }
    if (u.pathname === "/audit/ghost") { res.writeHead(404); return res.end("{}"); }
    res.writeHead(200, { "content-type": "application/json" });
    const before = u.searchParams.get("before"), n = Math.min(Number(u.searchParams.get("limit")), 200);
    res.end(JSON.stringify({ app: "tide", rows: ROWS.filter((r) => before === null || r.id < Number(before)).slice(0, n) }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
});
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

async function connect(token: string) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: "http://127.0.0.1:1", PN_CONTROL: `http://127.0.0.1:${port}`, PN_OWNER_TOKEN: token };
  delete env.PN_APPS;
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
  return c;
}

describe("audit_log", () => {
  it("is listed as read-only and returns rows newest first", async () => {
    const c = await connect("good");
    const tool = (await c.listTools()).tools.find((t) => t.name === "audit_log");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    const r: any = await c.callTool({ name: "audit_log", arguments: { app: "tide" } });
    expect(r.isError).toBeFalsy();
    const rows = r.structuredContent.rows;
    expect(rows).toHaveLength(50);
    expect(rows[0]).toEqual({ actor: "agent", action: "rollback", subject: "r300", at: "2026-11-01" });
    expect(JSON.stringify(r)).not.toContain("good");
    await c.close();
  });
  it("clamps limit to 1..200", async () => {
    const c = await connect("good");
    const big: any = await c.callTool({ name: "audit_log", arguments: { app: "tide", limit: 5000 } });
    expect(big.structuredContent.rows).toHaveLength(200);
    const zero: any = await c.callTool({ name: "audit_log", arguments: { app: "tide", limit: 0 } });
    expect(zero.structuredContent.rows).toHaveLength(1);
    await c.close();
  });
  it("filters by action, paging as needed", async () => {
    const c = await connect("good");
    const r: any = await c.callTool({ name: "audit_log", arguments: { app: "tide", action: "rollback", limit: 120 } });
    const rows = r.structuredContent.rows;
    expect(rows).toHaveLength(100); // 300 rows, every third is a rollback
    expect(rows.every((x: any) => x.action === "rollback")).toBe(true);
    await c.close();
  });
  it("returns typed unauthorized and not_found errors", async () => {
    const c = await connect("bad");
    const r: any = await c.callTool({ name: "audit_log", arguments: { app: "tide" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.code).toBe("unauthorized");
    expect(JSON.stringify(r)).not.toContain("bad\"");
    await c.close();
    const g = await connect("good");
    const n: any = await g.callTool({ name: "audit_log", arguments: { app: "ghost" } });
    expect(n.structuredContent.code).toBe("not_found");
    await g.close();
  });
});
