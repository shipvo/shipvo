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
const sent: any[] = [];

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {}; res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/apps") return res.end(JSON.stringify({ ok: true, apps: [] }));
    if (body.action !== "pending_banner") sent.push(body);
    if (body.url?.includes("localhost")) return res.end(JSON.stringify({ ok: false, code: "host_not_allowed", error: "localhost is a private host" }));
    res.end(JSON.stringify({ ok: true, source: "web", url: "https://shop.test/", title: "Shop", tree: '- button "Pay" [ref=e2]' }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
});
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

describe("browser tools", () => {
  it("forward to the simulator and mark the page as untrusted web content", async () => {
    const c = new Client({ name: "test", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env: { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${port}`, PN_CONTROL: "http://127.0.0.1:1" } }));
    const names = (await c.listTools()).tools.map((t) => t.name);
    for (const n of ["browser_open", "browser_snapshot", "browser_click", "browser_type", "browser_back", "browser_screenshot", "browser_tabs", "browser_close_tab", "browser_scroll", "browser_wait_for"]) expect(names).toContain(n);
    const r: any = await c.callTool({ name: "browser_open", arguments: { session: "s1", url: "https://shop.test/", allow_hosts: ["shop.test"] } });
    expect(sent.at(-1)).toMatchObject({ action: "browser_open", url: "https://shop.test/", allow_hosts: ["shop.test"] });
    expect(JSON.parse(r.content[0].text)).toMatchObject({ source: "web", untrusted: true, tree: '- button "Pay" [ref=e2]' });
    const k: any = await c.callTool({ name: "browser_click", arguments: { session: "s1", ref: "e2" } });
    expect(k.isError).toBeFalsy(); expect(sent.at(-1)).toMatchObject({ action: "browser_click", ref: "e2" });
    const w: any = await c.callTool({ name: "browser_wait_for", arguments: { session: "s1", text: "Pay", timeout_ms: 500 } });
    expect(w.isError).toBeFalsy(); expect(sent.at(-1)).toMatchObject({ action: "browser_wait_for", text: "Pay", timeout_ms: 500 });
    await c.callTool({ name: "browser_scroll", arguments: { session: "s1", dy: 300 } });
    expect(sent.at(-1)).toMatchObject({ action: "browser_scroll", dy: 300 });
    await c.callTool({ name: "browser_close_tab", arguments: { session: "s1", index: 1 } });
    expect(sent.at(-1)).toMatchObject({ action: "browser_close_tab", index: 1 });
    const bad: any = await c.callTool({ name: "browser_open", arguments: { session: "s1", url: "http://localhost:3000/" } });
    expect(bad.isError).toBe(true); expect(bad.content[0].text).toContain("[host_not_allowed]");
    await c.close();
  }, 60000);
});
