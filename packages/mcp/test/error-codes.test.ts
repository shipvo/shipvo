import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(__dirname, "..");
let listFails = false; let out = ""; let fake: http.Server; let port = 0;

// Stand-in simulator that behaves like the real one: only session "live" exists.
beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    res.writeHead(200, { "content-type": "application/json" });
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/sessions" && listFails) return res.end(JSON.stringify({ ok: false, code: "sim_busy", error: "simulator is busy" }));
    if (req.url === "/sessions") return res.end(JSON.stringify({ ok: true, sessions: [{ session: "live", app: "menu", release: "local", started_at: null }] }));
    if (req.url === "/act" && body.session !== "live") return res.end(JSON.stringify({ ok: false, code: "no_session", error: `no session '${body.session}': call /session first`, screen: null }));
    if (req.url === "/act" && body.ref === "e999") return res.end(JSON.stringify({ ok: false, code: "stale_ref", error: "stale ref e999: the screen changed. Take a new snapshot (action \"screen\") and use a ref from it.", screen: "heading Menu" }));
    res.end(JSON.stringify({ ok: true, screen: "heading Menu" }));
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

const CALLS: [string, Record<string, unknown>][] = [
  ["screen", {}], ["tap", { ref: "e1" }], ["type", { ref: "e1", text: "x" }], ["scroll", { direction: "down" }], ["back", {}],
  ["screenshot", {}], ["set_device", { online: false }], ["push_notification", { title: "t", body: "b" }], ["notifications", {}],
  ["open_notification", {}], ["open_url", { url: "myapp://x" }], ["device_log", {}], ["device_reset", {}], ["end_session", {}],
];

describe("unknown session", () => {
  it.each(CALLS)("%s returns isError, a typed code and a plain message", async (name, args) => {
    const c = await connect();
    const r: any = await c.callTool({ name, arguments: { session: "ghost", ...args } });
    expect(r.isError).toBe(true);
    expect(typeof r.structuredContent?.code).toBe("string");
    expect(r.structuredContent.code).toBe("no_session");
    expect(r.structuredContent.error).toMatch(/no session 'ghost'/);
    await c.close();
  });
});

describe("end_session", () => {
  it("ends a session the simulator lists even if this server did not open it", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "end_session", arguments: { session: "live" } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content[0].text)).toMatchObject({ session: "live", steps: 0 });
    await c.close();
  });
  it("returns no_session for an id the simulator does not list", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "end_session", arguments: { session: "ghost" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, code: "no_session" });
    await c.close();
  });
  it("returns the simulator's own error, not no_session, when /sessions fails", async () => {
    listFails = true;
    try {
      const c = await connect();
      const r: any = await c.callTool({ name: "end_session", arguments: { session: "live" } });
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toMatchObject({ ok: false, code: "sim_busy" });
      await c.close();
    } finally { listFails = false; }
  });
});

describe("bad input", () => {
  it("tap with a ref that does not exist returns a typed code", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "tap", arguments: { session: "live", ref: "e999" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, code: "stale_ref" });
    await c.close();
  });
  it("open_app with an unknown app returns unknown_app", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "open_app", arguments: { app: "no-such-app" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, code: "unknown_app" });
    expect(r.structuredContent.error).toMatch(/unknown app "no-such-app"/);
    await c.close();
  });
});
