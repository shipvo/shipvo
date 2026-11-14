// The approval guard on taps (SHIPVO_GUARD) and secret typing, against a stand-in simulator.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const root = resolve(__dirname, "..");
let out = ""; let fake: http.Server; let port = 0;
const SHOP = '- heading "Basket"\n- button "Add to cart" [ref=e1]\n- button "Place order" [ref=e2]\n- textbox "Password" [ref=e3]\n- textbox "Name" [ref=e4]';
const PAID = '- heading "Thanks"\n- text "Order placed"';
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
    if (req.url === "/session") return res.end(JSON.stringify({ ok: true, app: "shop", release: "local", screen: SHOP }));
    if (body.action === "tap") return res.end(JSON.stringify({ ok: true, screen: body.ref === "e2" ? PAID : SHOP }));
    // The simulator marks a password field itself; the typed text shows in the tree here so the test can see it masked.
    if (body.action === "type") return res.end(JSON.stringify({ ok: true, ...(body.ref === "e3" || body.secret ? { secret: true, value: null } : { value: body.text }), screen: SHOP.replace(`[ref=${body.ref}]`, `[ref=${body.ref}]: ${body.text}`) }));
    res.end(JSON.stringify({ ok: true, screen: SHOP }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
}, 120000);
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });
beforeEach(() => { calls = []; });

async function connect(o: { guard?: string; answer?: string } = {}) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${port}`, PN_CONTROL: "http://127.0.0.1:1", PN_APPS: JSON.stringify({ shop: { name: "Shop", description: "x" } }) };
  delete env.SHIPVO_GUARD; if (o.guard) env.SHIPVO_GUARD = o.guard;
  const asked: string[] = [];
  const c = new Client({ name: "test", version: "0" }, o.answer ? { capabilities: { elicitation: {} } } : undefined);
  if (o.answer) c.setRequestHandler(ElicitRequestSchema, async (req) => { asked.push(req.params.message); return { action: "accept", content: { decision: o.answer! } }; });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
  await c.callTool({ name: "open_app", arguments: { app: "shop", session: "g", attach: "never" } });
  calls = [];
  return { c, asked };
}
const tapped = () => calls.filter((x) => x.body.action === "tap").map((x) => x.body.ref);
const txt = (r: any) => r.content[0].text as string;

describe("approval guard on taps", () => {
  it("is off by default: Place order is tapped", async () => {
    const { c } = await connect();
    const r: any = await c.callTool({ name: "tap", arguments: { session: "g", ref: "e2" } });
    expect(r.isError).toBeFalsy(); expect(tapped()).toEqual(["e2"]);
    await c.close();
  });
  it("with SHIPVO_GUARD=on a client that cannot ask gets approval_needed and nothing is tapped", async () => {
    const { c } = await connect({ guard: "on" });
    const r: any = await c.callTool({ name: "tap", arguments: { session: "g", ref: "e2" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, code: "approval_needed", tapped: 0 });
    expect(txt(r)).toContain('"Place order" spends money');
    expect(tapped()).toEqual([]);
    const ok: any = await c.callTool({ name: "tap", arguments: { session: "g", ref: "e2", approved: true } });
    expect(ok.isError).toBeFalsy(); expect(tapped()).toEqual(["e2"]);
    await c.close();
  });
  it("ordinary buttons are tapped with the guard on", async () => {
    const { c } = await connect({ guard: "on" });
    await c.callTool({ name: "tap", arguments: { session: "g", ref: "e1" } });
    expect(tapped()).toEqual(["e1"]);
    await c.close();
  });
  it("a client that can ask is asked; Decline stops the tap", async () => {
    const { c, asked } = await connect({ guard: "on", answer: "Decline" });
    const r: any = await c.callTool({ name: "tap", arguments: { session: "g", ref: "e2" } });
    expect(asked).toEqual(['The agent wants to tap "Place order" in shop. This spends money. Allow it?']);
    expect(r.structuredContent).toMatchObject({ ok: false, code: "tap_declined" });
    expect(tapped()).toEqual([]);
    await c.close();
  });
  it("Allow for this session taps now and does not ask again", async () => {
    const { c, asked } = await connect({ guard: "on", answer: "Allow for this session" });
    await c.callTool({ name: "tap", arguments: { session: "g", ref: "e2" } });
    await c.callTool({ name: "tap", arguments: { session: "g", ref: "e2" } });
    expect(asked).toHaveLength(1); expect(tapped()).toEqual(["e2", "e2"]);
    await c.close();
  });
  it("a path stops at a guarded step and says how many taps were made", async () => {
    const { c } = await connect({ guard: "on" });
    const r: any = await c.callTool({ name: "tap", arguments: { session: "g", ref: "e1", then: ["Place order"] } });
    expect(r.structuredContent).toMatchObject({ code: "approval_needed", tapped: 1 });
    expect(tapped()).toEqual(["e1"]);
    await c.close();
  });
});

describe("secret typing", () => {
  it("a password field: the text is typed and stays out of the result", async () => {
    const { c } = await connect();
    const r: any = await c.callTool({ name: "type", arguments: { session: "g", ref: "e3", text: "hunter2-secret", compact: false } });
    expect(calls.find((x) => x.body.action === "type")!.body.text).toBe("hunter2-secret");
    expect(JSON.stringify(r)).not.toContain("hunter2-secret");
    expect(txt(r)).toContain("Value of e3: hidden (a secret field)");
    expect(r.structuredContent.secret).toBe(true);
    await c.close();
  });
  it("secret: true does the same for any field, and tells the simulator", async () => {
    const { c } = await connect();
    const r: any = await c.callTool({ name: "type", arguments: { session: "g", ref: "e4", text: "492817", secret: true } });
    expect(calls.find((x) => x.body.action === "type")!.body.secret).toBe(true);
    expect(JSON.stringify(r)).not.toContain("492817");
    await c.close();
  });
  it("an ordinary field still returns its value", async () => {
    const { c } = await connect();
    const r: any = await c.callTool({ name: "type", arguments: { session: "g", ref: "e4", text: "Ana" } });
    expect(txt(r)).toContain('Value of e4: "Ana"');
    await c.close();
  });
  it("an exported test reads a secret from the environment, never from the file", async () => {
    const { c } = await connect();
    await c.callTool({ name: "type", arguments: { session: "g", ref: "e4", text: "492817", secret: true } });
    const e: any = await c.callTool({ name: "export_test", arguments: { session: "g" } });
    expect(JSON.stringify(e)).not.toContain("492817");
    await c.close();
  });
});
