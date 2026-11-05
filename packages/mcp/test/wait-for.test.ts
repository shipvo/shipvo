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
const A = ['- heading "Cart"', '- button "Pay" [ref=e1]'].join("\n");
const B = ['- heading "Cart"', '- button "Pay" [ref=e1]', '- text "Paid"'].join("\n");
const C = ['- heading "Cart"', '- text "Loading"'].join("\n");
// The screen the fake simulator shows now. `later` replaces it after `delay` ms, on a tap.
let screen = A; let reads = 0; let flips: [number, string][] = [];
beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/session") { screen = A; return res.end(JSON.stringify({ ok: true, screen })); }
    if (req.url === "/sessions") return res.end(JSON.stringify({ ok: true, sessions: [] }));
    if (body.action === "tap") for (const [d, s] of flips) setTimeout(() => { screen = s; }, d);
    if (body.action === "screen") reads++;
    res.end(JSON.stringify({ ok: true, screen, delivered: true }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
});
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

async function connect() {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${port}`, PN_CONTROL: "http://127.0.0.1:1", PN_APPS: JSON.stringify({ shop: { name: "Shop", description: "x" } }) };
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
  return c;
}
const txt = (r: any) => r.content[0].text as string;
async function opened() { const c = await connect(); await c.callTool({ name: "open_app", arguments: { app: "shop", session: "w" } }); reads = 0; return c; }

describe("wait_for and settle", () => {
  it("matches text that appears after the tap", async () => {
    flips = [[250, B]]; const c = await opened();
    const r: any = await c.callTool({ name: "tap", arguments: { session: "w", ref: "e1", wait_for: { text: "Paid" } } });
    expect(r.structuredContent.waited.matched).toBe(true);
    expect(r.structuredContent.waited.ms).toBeGreaterThanOrEqual(200);
    expect(txt(r)).toMatch(/Waited: matched/); expect(txt(r)).toContain('text "Paid"');
    await c.close();
  });
  it("times out, keeping the action result", async () => {
    flips = []; const c = await opened();
    const r: any = await c.callTool({ name: "tap", arguments: { session: "w", ref: "e1", wait_for: { role: "button", name: "Done" }, timeout_ms: 300 } });
    expect(r.structuredContent.waited.matched).toBe(false);
    expect(r.structuredContent.waited.ms).toBeGreaterThanOrEqual(290);
    expect(r.isError).toBeFalsy(); expect(txt(r)).toMatch(/Waited: timed out/); expect(txt(r)).toContain('button "Pay"');
    await c.close();
  });
  it("waits for gone: true", async () => {
    flips = [[250, C]]; const c = await opened();
    const r: any = await c.callTool({ name: "tap", arguments: { session: "w", ref: "e1", wait_for: { ref: "e1", gone: true } } });
    expect(r.structuredContent.waited.matched).toBe(true); expect(txt(r)).not.toContain("Pay");
    await c.close();
  });
  it("settle waits until two reads agree", async () => {
    flips = [[30, C], [150, B]]; const c = await opened();
    const r: any = await c.callTool({ name: "tap", arguments: { session: "w", ref: "e1", settle: true } });
    expect(r.structuredContent.waited.matched).toBe(true); expect(txt(r)).toContain('text "Paid"'); expect(reads).toBeGreaterThanOrEqual(3);
    await c.close();
  });
  it("wait_for catches a result that arrives after a pause", async () => {
    flips = [[50, C], [1000, B]]; const c = await opened();
    const r: any = await c.callTool({ name: "tap", arguments: { session: "w", ref: "e1", wait_for: { text: "Paid" }, timeout_ms: 3000 } });
    expect(r.structuredContent.waited.matched).toBe(true); expect(txt(r)).toContain('text "Paid"'); expect(txt(r)).not.toContain("Loading");
    await c.close();
  });
  it("tap and wait fields tell assistants to wait for work", async () => {
    const c = await connect(); const { tools } = await c.listTools();
    const tap: any = tools.find((t) => t.name === "tap");
    expect(tap.description).toMatch(/wait_for/); expect(tap.description).toMatch(/settle/);
    expect(tap.inputSchema.properties.settle.description).toMatch(/after any action that starts work/);
    await c.close();
  });
  it("adds nothing without the fields", async () => {
    flips = []; const c = await opened();
    const r: any = await c.callTool({ name: "tap", arguments: { session: "w", ref: "e1" } });
    expect(r.structuredContent.waited).toBeUndefined(); expect(txt(r)).not.toContain("Waited:"); expect(reads).toBe(0);
    await c.close();
  });
});
