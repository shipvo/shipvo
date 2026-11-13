// The A2UI tools: a2ui_open, a2ui_send and a2ui_actions, against a stand-in simulator.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(__dirname, "..");
let out = ""; let fake: http.Server; let port = 0;
const SCREEN = '- paragraph: "Hi"';
const SURFACE = { version: "1.0", createSurface: { surfaceId: "s", components: [{ id: "root", component: "Text", text: "Hi" }] } };
const ACTIONS = [{ version: "1.0", action: { name: "buy", surfaceId: "s", sourceComponentId: "b", context: { qty: 2 } } }, { version: "1.0", action: { name: "cancel", surfaceId: "s", sourceComponentId: "c", context: {} } }];
let calls: { url: string; body: any }[] = [];

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ url: req.url ?? "", body });
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/sessions") return res.end(JSON.stringify({ ok: true, sessions: [] }));
    if (req.url === "/session") {
      const bad = body.a2ui_messages.filter((m: any) => !m.version);
      return res.end(JSON.stringify({ ok: true, app: "a2ui", release: "a2ui", applied: body.a2ui_messages.length - bad.length, errors: bad.map(() => ({ code: "VALIDATION_FAILED", message: "version must be 1.0" })), screen: SCREEN }));
    }
    if (body.action === "a2ui_send") return res.end(JSON.stringify(body.session === "plain" ? { ok: false, code: "not_agent_ui", error: "this session is not an A2UI session: open it with a2ui: true" } : { ok: true, applied: 1, errors: [], surfaces: ["s"], screen: '- paragraph: "two"' }));
    if (body.action === "a2ui_actions") return res.end(JSON.stringify({ ok: true, messages: ACTIONS.slice(body.since ?? 0), next: ACTIONS.length, effects: [], surfaces: ["s"] }));
    res.end(JSON.stringify({ ok: true, screen: SCREEN }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
}, 120000);
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });
beforeEach(() => { calls = []; });

async function connect() {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${port}`, PN_CONTROL: "http://127.0.0.1:1", PN_APPS: JSON.stringify({ shop: { name: "Shop", description: "x" } }) };
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
  return c;
}
const sessionCall = () => calls.find((c) => c.url === "/session")!.body;

describe("a2ui_open", () => {
  it("opens the messages on a phone model and returns the session and the screen", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "a2ui_open", arguments: { messages: [SURFACE], session: "a1", model: "iPhone 16 Pro" } });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toBe('Session: a1\n1 applied\n\n- paragraph: "Hi"');
    expect(r.structuredContent).toEqual({ ok: true, session: "a1", applied: 1, errors: [] });
    expect(sessionCall()).toEqual({ session: "a1", a2ui: true, a2ui_messages: [SURFACE], model: "iPhone 16 Pro" });
    await c.close();
  });
  it("names a session when none is given, and lists each refused message with its reason", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "a2ui_open", arguments: { messages: [SURFACE, { createSurface: {} }] } });
    expect(r.structuredContent.session).toMatch(/^a2ui-/);
    expect(r.content[0].text).toContain("1 applied, 1 refused:\n  VALIDATION_FAILED: version must be 1.0");
    expect(r.structuredContent.errors).toEqual([{ code: "VALIDATION_FAILED", message: "version must be 1.0" }]);
    await c.close();
  });
});

describe("a2ui_send and a2ui_actions", () => {
  it("a2ui_send applies more messages and returns the screen after them", async () => {
    const c = await connect();
    const msg = { version: "1.0", updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Text", text: "two" }] } };
    const r: any = await c.callTool({ name: "a2ui_send", arguments: { session: "a1", messages: [msg] } });
    expect(r.content[0].text).toBe('1 applied\n\n- paragraph: "two"');
    expect(r.structuredContent).toEqual({ ok: true, applied: 1, errors: [], surfaces: ["s"] });
    expect(calls.find((x) => x.body.action === "a2ui_send")!.body).toMatchObject({ session: "a1", messages: [msg] });
    await c.close();
  });
  it("a2ui_send on a session that is not A2UI returns not_agent_ui", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "a2ui_send", arguments: { session: "plain", messages: [SURFACE] } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.code).toBe("not_agent_ui");
    await c.close();
  });
  it("a2ui_actions returns what the person did, and only the newer ones with since", async () => {
    const c = await connect();
    const all: any = await c.callTool({ name: "a2ui_actions", arguments: { session: "a1" } });
    expect(all.structuredContent).toEqual({ ok: true, messages: ACTIONS, next: 2, effects: [], surfaces: ["s"] });
    expect(all.content[0].text.split("\n")).toHaveLength(2);
    const newer: any = await c.callTool({ name: "a2ui_actions", arguments: { session: "a1", since: 1 } });
    expect(newer.structuredContent.messages).toEqual([ACTIONS[1]]);
    await c.close();
  });
  it("the three tools are in the tool list, and a2ui_actions is read-only", async () => {
    const c = await connect();
    const list = (await c.listTools()).tools;
    for (const n of ["a2ui_open", "a2ui_send", "a2ui_actions"]) expect(list.some((t) => t.name === n)).toBe(true);
    expect(list.find((t) => t.name === "a2ui_actions")!.annotations?.readOnlyHint).toBe(true);
    await c.close();
  });
});
