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
const seen: string[] = [];
// A tiny simulator that follows the update rules: enough to check what the tools send and how they report typed errors.
let state = "idle";
beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    res.writeHead(200, { "content-type": "application/json" });
    const body = raw ? JSON.parse(raw) : {};
    if (req.url !== "/act") return res.end(JSON.stringify({ ok: true }));
    seen.push(body.action);
    const fail = (code: string) => res.end(JSON.stringify({ ok: false, code, error: code }));
    if (body.action === "check_for_update") { if (state === "applied") return fail("no_update"); state = "ready"; }
    if (body.action === "apply_update") { if (state !== "ready") return fail("not_ready"); state = "applied"; }
    res.end(JSON.stringify({ ok: true, update: { state, release: 1, reason: null }, banner: state === "ready" ? "Simulated: update ready: release 2" : null, screen: "App screen" }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
});
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as any;
async function connect() {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${port}`, PN_CONTROL: "http://127.0.0.1:1" };
  delete env.PN_APPS;
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
  return c;
}

describe("phone update tools", () => {
  it("lists the three tools with their schemas", async () => {
    const c = await connect();
    const tools = (await c.listTools()).tools.filter((t) => ["get_update_state", "check_for_update", "apply_update"].includes(t.name)).sort((a, b) => a.name.localeCompare(b.name));
    expect(tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema }))).toMatchSnapshot();
    expect(tools.find((t) => t.name === "get_update_state")?.annotations?.readOnlyHint).toBe(true);
    await c.close();
  });
  it("apply before check is not_ready; check then apply works; a second check is no_update", async () => {
    const c = await connect();
    expect((await call(c, "apply_update", { session: "s" })).structuredContent.code).toBe("not_ready");
    const k = await call(c, "check_for_update", { session: "s" });
    expect(k.structuredContent).toMatchObject({ update: { state: "ready" }, banner: "Simulated: update ready: release 2", simulated: true });
    expect((await call(c, "apply_update", { session: "s" })).structuredContent.update.state).toBe("applied");
    const g = await call(c, "get_update_state", { session: "s" });
    expect(g.isError).toBeFalsy(); expect(g.content[0].text).toContain("App screen");
    const n = await call(c, "check_for_update", { session: "s" });
    expect(n.isError).toBe(true); expect(n.structuredContent.code).toBe("no_update");
    expect(seen).toContain("get_update_state");
    await c.close();
  });
});
