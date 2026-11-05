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
const LOGIN = ['- heading "Sign in"', '- textbox "Email" [ref=e1]', '- textbox "Password" [ref=e2]', '- button "Go" [ref=e3]', '- button "More" [ref=e4]', '- button "More" [ref=e5]'].join("\n");
const HOME = ['- heading "Home"', '- button "Settings" [ref=e1]'].join("\n");
let screen = LOGIN;

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/session") { screen = LOGIN; return res.end(JSON.stringify({ ok: true, screen })); }
    if (req.url === "/sessions") return res.end(JSON.stringify({ ok: true, sessions: [] }));
    if (body.action === "tap" && body.ref === "e3") screen = HOME;
    if (body.action === "back") screen = LOGIN;
    res.end(JSON.stringify({ ok: true, screen }));
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

describe("export_test", () => {
  it("exports a recorded session", async () => {
    const c = await connect();
    expect((await c.listTools()).tools.find((t) => t.name === "export_test")?.annotations?.readOnlyHint).toBe(true);
    await c.callTool({ name: "open_app", arguments: { app: "shop", session: "s1" } });
    await c.callTool({ name: "type", arguments: { session: "s1", ref: "e1", text: "ana@example.com" } });
    await c.callTool({ name: "type", arguments: { session: "s1", ref: "e2", text: "hunter2" } });
    await c.callTool({ name: "tap", arguments: { session: "s1", ref: "e4" } });
    await c.callTool({ name: "tap", arguments: { session: "s1", ref: "e3" } });
    await c.callTool({ name: "back", arguments: { session: "s1" } });
    await c.callTool({ name: "screen", arguments: { session: "s1" } });
    const t = txt(await c.callTool({ name: "export_test", arguments: { session: "s1" } }));
    expect(t).toContain('openApp({ app: "shop" })');
    expect(t).toContain('await phone.type("Email", "ana@example.com");');
    expect(t).toContain('await phone.type("Password", process.env.SHIPVO_TEST_PASSWORD!);');
    expect(t).not.toContain("hunter2");
    expect(t).toContain('// TODO: ambiguous target "More"');
    expect(t).toContain('await phone.tap("Go");');
    expect(t).toContain("await phone.back();");
    expect(t).not.toContain("screen(");
    await c.close();
  });
  it("never exports the payment pin", async () => {
    const c = await connect();
    await c.callTool({ name: "open_app", arguments: { app: "shop", session: "s2" } });
    await c.callTool({ name: "set_device", arguments: { session: "s2", payment: { nextResult: "approve", pin: "4321" } } });
    const t = txt(await c.callTool({ name: "export_test", arguments: { session: "s2" } }));
    expect(t).toContain("phone.device.set(");
    expect(t).toContain("approve");
    expect(t).not.toContain("4321");
    await c.close();
  });
  it("returns no_session for an unknown session", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "export_test", arguments: { session: "ghost" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, code: "no_session" });
    await c.close();
  });
});
