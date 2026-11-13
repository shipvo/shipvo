// open_app with a phone model, screenshot of the phone in its frame, and the phone_models tool, against a stand-in simulator.
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
const SCREEN = '- heading "Shop"\n- button "Buy" [ref=e1]';
const PNG = Buffer.from("not a real png").toString("base64");
const MODELS = [
  { name: "Pixel 8", platform: "android", width: 412, height: 915, scale: 2.625 },
  { name: "iPhone 16 Pro", platform: "ios", width: 402, height: 874, scale: 3 },
];
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
    if (req.url === "/models") return res.end(JSON.stringify({ ok: true, models: MODELS, defaults: { android: "Pixel 8", ios: "iPhone 16 Pro" } }));
    if (req.url === "/sessions") return res.end(JSON.stringify({ ok: true, sessions: [] }));
    if (req.url === "/session") {
      if (body.model === "Nokia 3310") return res.end(JSON.stringify({ ok: false, code: "bad_model", error: 'unknown phone model "Nokia 3310". Models: Pixel 8, iPhone 16 Pro' }));
      return res.end(JSON.stringify({ ok: true, app: "shop", release: "local", ...(body.model ? { model: body.model, skin: "ios" } : {}), screen: SCREEN }));
    }
    if (body.action === "screenshot") return res.end(JSON.stringify({ ok: true, image: PNG, mime: "image/png", screen: SCREEN }));
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

describe("open_app with a phone model", () => {
  it("sends the model to the simulator and returns the first screen", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "open_app", arguments: { app: "shop", session: "m1", model: "iPhone 16 Pro", attach: "never" } });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('button "Buy"');
    expect(sessionCall().model).toBe("iPhone 16 Pro");
    await c.close();
  });
  it("sends no model when none is asked for", async () => {
    const c = await connect();
    await c.callTool({ name: "open_app", arguments: { app: "shop", session: "m2", attach: "never" } });
    expect("model" in sessionCall()).toBe(false);
    await c.close();
  });
  it("returns bad_model with the simulator's list for a name it does not know", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "open_app", arguments: { app: "shop", session: "m3", model: "Nokia 3310", attach: "never" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, code: "bad_model" });
    expect(r.content[0].text).toContain("Pixel 8");
    await c.close();
  });
});

describe("screenshot of the phone in its frame", () => {
  it("asks the simulator for the frame only when frame is true", async () => {
    const c = await connect();
    await c.callTool({ name: "open_app", arguments: { app: "shop", session: "s1", attach: "never" } });
    const framed: any = await c.callTool({ name: "screenshot", arguments: { session: "s1", frame: true } });
    const plain: any = await c.callTool({ name: "screenshot", arguments: { session: "s1" } });
    const shots = calls.filter((x) => x.body.action === "screenshot").map((x) => x.body.frame);
    expect(shots).toEqual([true, undefined]);
    for (const r of [framed, plain]) { expect(r.content[0].type).toBe("image"); expect(r.content[0].data).toBe(PNG); }
    await c.close();
  });
});

describe("phone_models", () => {
  it("lists the models with platform, screen size and pixel ratio, and the defaults", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "phone_models", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain("Defaults: android is Pixel 8, ios is iPhone 16 Pro");
    expect(r.content[0].text).toContain("iPhone 16 Pro | ios | 402x874 @3x");
    expect(r.structuredContent).toEqual({ ok: true, models: MODELS, defaults: { android: "Pixel 8", ios: "iPhone 16 Pro" } });
    await c.close();
  });
  it("is in the tool list with a description that points at open_app", async () => {
    const c = await connect();
    const t = (await c.listTools()).tools.find((x) => x.name === "phone_models")!;
    expect(t.description).toContain("open_app");
    expect(t.annotations?.readOnlyHint).toBe(true);
    const open = (await c.listTools()).tools.find((x) => x.name === "open_app")!;
    expect(Object.keys((open.inputSchema as any).properties)).toContain("model");
    await c.close();
  });
});
