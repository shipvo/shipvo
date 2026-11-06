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
    if (req.url === "/act" && body.ref === "e998") return res.end(JSON.stringify({ ok: false, code: "disabled", delivery: "not_delivered", reason: "disabled", safe_to_retry: true, error: "e998 is disabled", screen: "heading Menu" }));
    if (req.url === "/act" && ["lock", "unlock", "tap"].includes(body.action) && body.ref !== "e1x") {
      const st = (globalThis as any).__locked ??= { v: false };
      if (body.action === "lock") { if (st.v) return res.end(JSON.stringify({ ok: false, code: "already_locked", error: "the phone is already locked: call unlock first" })); st.v = true; return res.end(JSON.stringify({ ok: true, locked: true, screen: "Lock screen" })); }
      if (body.action === "unlock") { if (!st.v) return res.end(JSON.stringify({ ok: false, code: "not_locked", error: "the phone is not locked" })); st.v = false; return res.end(JSON.stringify({ ok: true, locked: false, screen: "heading Menu" })); }
      if (st.v) return res.end(JSON.stringify({ ok: false, code: "phone_locked", error: "the phone is locked, so nothing was sent to the app. Call unlock first." }));
    }
    if (req.url === "/act" && body.action === "toggle_tile" && body.tile === "wifi") return res.end(JSON.stringify({ ok: false, code: "tile_not_visible", error: "open_notifications first" }));
    if (req.url === "/act" && body.action === "open_control_center") return res.end(JSON.stringify({ ok: false, code: "no_control_center", error: "an Android phone has no Control Center" }));
    if (req.url === "/act" && ["open_notifications", "toggle_tile", "dismiss_notification", "close_panels"].includes(body.action)) return res.end(JSON.stringify({ ok: true, panel: "shade", screen: `Notification shade (${body.action}:${body.tile ?? body.id ?? ""})` }));
    if (req.url === "/act" && body.action === "kill_app") return res.end(JSON.stringify({ ok: false, code: "recents_not_open", error: "open the app switcher first (open_recents), then kill_app" }));
    if (req.url === "/act" && ["press_home", "open_recents", "resume_app"].includes(body.action)) return res.end(JSON.stringify({ ok: true, appState: body.action === "resume_app" ? "active" : "background", screen: "Home screen" }));
    if (req.url === "/act" && body.action === "type") return res.end(JSON.stringify({ ok: true, delivery: "delivered", value: body.text, screen: "- textbox \"Name\" [ref=e1]: ignored" }));
    if (req.url === "/act" && body.action === "push_notification") return res.end(JSON.stringify({ ok: true, delivered: body.title !== "blocked", screen: "heading Menu" }));
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
  ["open_notification", {}], ["open_url", { url: "myapp://x" }], ["device_log", {}], ["device_reset", {}], ["end_session", {}], ["export_test", {}],
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

describe("lock and unlock", () => {
  it("return typed errors for out-of-order calls and input while locked", async () => {
    const c = await connect();
    const call = (name: string, args: Record<string, unknown> = {}) => c.callTool({ name, arguments: { session: "live", ...args } }) as Promise<any>;
    const a = await call("unlock"); expect(a.isError).toBe(true); expect(a.structuredContent.code).toBe("not_locked");
    expect((await call("lock")).isError).toBeFalsy();
    const b = await call("lock"); expect(b.isError).toBe(true); expect(b.structuredContent.code).toBe("already_locked");
    const t = await call("tap", { ref: "e1" }); expect(t.isError).toBe(true); expect(t.structuredContent.code).toBe("phone_locked");
    expect((await call("unlock")).isError).toBeFalsy();
    await c.close();
  });
});

describe("notification shade tools", () => {
  it("send the right actions and return typed errors", async () => {
    const c = await connect();
    const call = (name: string, args: Record<string, unknown> = {}) => c.callTool({ name, arguments: { session: "live", ...args } }) as Promise<any>;
    expect((await call("open_notifications")).isError).toBeFalsy();
    expect((await call("toggle_tile", { tile: "dark_mode" })).content[0].text).toContain("toggle_tile:dark_mode");
    expect((await call("dismiss_notification", { id: "n1" })).content[0].text).toContain("dismiss_notification:n1");
    expect((await call("close_panels")).isError).toBeFalsy();
    const a = await call("toggle_tile", { tile: "wifi" }); expect(a.isError).toBe(true); expect(a.structuredContent.code).toBe("tile_not_visible");
    const b = await call("open_control_center"); expect(b.isError).toBe(true); expect(b.structuredContent.code).toBe("no_control_center");
    await c.close();
  });
});

describe("home, recents and kill", () => {
  it("send the navigation actions and pass typed errors through", async () => {
    const c = await connect();
    const call = (name: string) => c.callTool({ name, arguments: { session: "live" } }) as Promise<any>;
    expect((await call("press_home")).isError).toBeFalsy();
    expect((await call("open_recents")).isError).toBeFalsy();
    expect((await call("resume_app")).isError).toBeFalsy();
    const k = await call("kill_app"); expect(k.isError).toBe(true); expect(k.structuredContent.code).toBe("recents_not_open");
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

describe("push_notification", () => {
  it("says so when permission blocked the push", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "push_notification", arguments: { session: "live", title: "blocked", body: "b" } });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toMatch(/^Not delivered: notification permission is not granted/);
    await c.close();
  });
  it("returns the plain screen when delivered", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "push_notification", arguments: { session: "live", title: "ok", body: "b" } });
    expect(r.content[0].text).toBe("heading Menu");
    await c.close();
  });
});

describe("delivery", () => {
  it("not_delivered carries reason and safe_to_retry, and keeps code and error", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "tap", arguments: { session: "live", ref: "e998" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, code: "disabled", delivery: "not_delivered", reason: "disabled", safe_to_retry: true });
    await c.close();
  });
  it("delivered actions say so; type gives the value the field holds", async () => {
    const c = await connect();
    expect(((await c.callTool({ name: "back", arguments: { session: "live" } })) as any).structuredContent).toEqual({ delivery: "delivered" });
    const r: any = await c.callTool({ name: "type", arguments: { session: "live", ref: "e1", text: "Ana" } });
    expect(r.structuredContent).toEqual({ delivery: "delivered", value: "Ana" });
    expect(r.content[0].text).toMatch(/^Change: /);
    await c.close();
  });
});
