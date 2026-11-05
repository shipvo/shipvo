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
const posts: string[] = [];

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  // a stand-in simulator that serves the scaffolded app "menu"
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    posts.push(req.url ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/apps") return res.end(JSON.stringify({ ok: true, apps: [{ id: "menu", name: "Table Menu" }] }));
    if (req.url === "/session") return res.end(JSON.stringify({ ok: true, app: "menu", release: "local", screen: "heading Table Menu" }));
    if (req.url === "/act" && JSON.parse(raw).session === "m1") return res.end(JSON.stringify({ ok: false, error: "no session 'm1': call /session first", screen: null }));
    if (req.url === "/act" && JSON.parse(raw).ref === "e5") return res.end(JSON.stringify({ ok: false, code: "stale_ref", error: 'stale ref e5: the screen changed. Take a new snapshot (action "screen") and use a ref from it.', screen: "- button \"Item 9\" [ref=e7]" }));
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
});
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

async function connect(extra: Record<string, string> = {}) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${port}`, PN_CONTROL: "http://127.0.0.1:1", ...extra };
  delete env.PN_APPS;
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
  return c;
}
const textOf = (r: any) => r.content[0].text as string;

describe("local mcp", () => {
  it("opens the app the simulator serves, with no PN_APPS", async () => {
    const c = await connect();
    expect(textOf(await c.callTool({ name: "list_apps", arguments: {} }))).toContain('menu: Table Menu');
    const r = await c.callTool({ name: "open_app", arguments: { app: "menu" } });
    expect(textOf(r)).toContain("app: menu");
    expect(posts).toContain("/session");
    await c.close();
  });
  it("still rejects an app the simulator does not serve", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "open_app", arguments: { app: "nope" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("Apps: menu");
    await c.close();
  });
  it("shows a stale ref as an error with its code, the fix and the new screen", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "tap", arguments: { session: "s", ref: "e5" } });
    expect(textOf(r)).toMatch(/^Error \[stale_ref\]: stale ref e5.*new snapshot/);
    expect(textOf(r)).toContain('Screen now:\n- button "Item 9" [ref=e7]');
    await c.close();
  });
  it("marks a failed call isError and puts the code in structuredContent", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "tap", arguments: { session: "s", ref: "e5" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, code: "stale_ref" });
    expect(r.structuredContent.error).toContain("stale ref e5");
    await c.close();
  });
  it("leaves a successful call without isError", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "screen", arguments: { session: "s" } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toBeUndefined();
    await c.close();
  });
  it("returns an error, not an empty log, for device_log on an unknown session", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "device_log", arguments: { session: "m1" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/^Error: no session 'm1'/);
    expect(textOf(r)).not.toContain('"log"');
    await c.close();
  });
  it("declares annotations on every tool", async () => {
    const c = await connect();
    const tools = (await c.listTools()).tools;
    const by = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    for (const t of tools) expect(t.annotations, t.name).toBeDefined();
    for (const n of ["list_apps", "list_sessions", "screen", "screenshot", "notifications", "device_log", "owner_describe"]) expect(by[n]?.readOnlyHint, n).toBe(true);
    for (const n of ["owner_command", "end_session"]) expect(by[n]?.destructiveHint, n).toBe(true);
    for (const n of ["open_app", "tap", "type", "scroll", "back", "set_device", "push_notification", "open_notification", "open_url", "device_reset"]) expect(by[n]?.readOnlyHint, n).toBe(false);
    await c.close();
  });
});

describe("simulator timeout", () => {
  it("returns sim_timeout within the limit and keeps serving", async () => {
    let hang = true; const open: http.ServerResponse[] = [];
    const slow = http.createServer(async (req, res) => {
      let raw = ""; for await (const ch of req) raw += ch;
      if (hang && (req.url === "/session" || (req.url === "/act" && JSON.parse(raw).action === "tap"))) { open.push(res); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, screen: "heading Home" }));
    });
    await new Promise<void>((r) => slow.listen(0, r));
    const p = (slow.address() as { port: number }).port;
    const c = await connect({ PN_SIM: `http://localhost:${p}`, SHIPVO_SIM_TIMEOUT_MS: "500" });
    const t0 = Date.now();
    const r: any = await c.callTool({ name: "tap", arguments: { session: "s", ref: "e1" } });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, code: "sim_timeout" });
    expect(textOf(r)).toContain('action "tap"');
    expect(textOf(r)).toContain("call screen");
    const o: any = await c.callTool({ name: "open_app", arguments: { app: "tide", session: "fresh" } });
    expect(o.isError).toBe(true);
    expect(o.structuredContent).toMatchObject({ ok: false, code: "sim_timeout" });
    expect(textOf(o)).not.toContain("release: local");
    hang = false;
    expect(textOf(await c.callTool({ name: "screen", arguments: { session: "s" } }))).toBe("heading Home");
    await c.close(); open.forEach((o) => o.destroy()); slow.close();
  });
});

describe("change line", () => {
  let c: Awaited<ReturnType<typeof connect>>;
  const screens: Record<string, string> = {};
  let step = "";
  beforeAll(async () => {
    const list = ['- heading "Shop"', '- button "Buy" [ref=e1]', '- button "Dead" [ref=e2]', '- textbox "Name" [ref=e3]', '- text "Row 1"', '- text "Row 2"', '- text "Row 3"', '- text "Row 4"'];
    screens.home = list.join("\n");
    screens.typed = list.map((l) => (l.includes("Name") ? l + ": Ana" : l)).join("\n");
    screens.attrs = list.map((l) => (l.includes("Name") ? '- textbox "Name" [ref=e3] [cursor=pointer]: Ana' : l)).join("\n");
    screens.quoted = list.map((l) => (l.includes("Name") ? `- 'textbox "a: b" [ref=e3]': Ana` : l)).join("\n");
    screens.gone = list.filter((l) => !l.includes("Name")).join("\n");
    screens.reordered = [list[0], ...list.slice(1).reverse()].join("\n");
    screens.badge = list.concat('- text "Added to cart" [ref=e9]').join("\n");
    screens.next = '- heading "Cart"\n- button "Pay" [ref=e4]';
    screens.scrolled = list.slice(0, 1).concat(['- text "Row 5"', '- text "Row 6"']).join("\n");
    fake.removeAllListeners("request");
    fake.on("request", async (req, res) => {
      let raw = ""; for await (const ch of req) raw += ch;
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/apps") return res.end(JSON.stringify({ ok: true, apps: [{ id: "menu" }] }));
      if (req.url === "/session") return res.end(JSON.stringify({ ok: true, screen: screens.home }));
      res.end(JSON.stringify({ ok: true, screen: screens[step] ?? screens.home }));
    });
    c = await connect();
    await c.callTool({ name: "open_app", arguments: { app: "menu", session: "chg" } });
  });
  afterAll(async () => { await c?.close(); });
  const act = async (name: string, s: string, args: Record<string, unknown> = {}) => { step = s; return textOf(await c.callTool({ name, arguments: { session: "chg", ...args } })); };

  it("says none when a tap changes nothing", async () => {
    expect(await act("tap", "home", { ref: "e2" })).toMatch(/^Change: none\n/);
  });
  it("says new screen on navigation", async () => {
    expect(await act("tap", "next", { ref: "e1" })).toMatch(/^Change: new screen\n/);
    expect(await act("back", "home")).toMatch(/^Change: new screen\n/);
  });
  it("gives the field value after typing", async () => {
    const t = await act("type", "typed", { ref: "e3", text: "Ana" });
    expect(t).toMatch(/^Change: content changed\nValue of e3: "Ana"/);
  });
  it("says scrolled after a scroll", async () => {
    expect(await act("scroll", "scrolled", { direction: "down" })).toMatch(/^Change: scrolled\n/);
    await act("scroll", "home", { direction: "up" });
  });
  it("compact returns only changed lines, shorter than the full tree, refs intact", async () => {
    await act("tap", "home", { ref: "e2" });
    const full = await act("tap", "badge", { ref: "e1" });
    await act("tap", "home", { ref: "e2" });
    const compact = await act("tap", "badge", { ref: "e1", compact: true });
    expect(full).toContain('- text "Row 1"');
    expect(compact).toContain('+ - text "Added to cart" [ref=e9]');
    expect(compact).not.toContain("Row 1");
    expect(compact.length).toBeLessThan(full.length);
  });
  it("finds the value when attributes follow the ref", async () => {
    await act("tap", "home", { ref: "e2" });
    expect(await act("type", "attrs", { ref: "e3", text: "Ana" })).toContain('Value of e3: "Ana"');
  });
  it("finds the value on a YAML-quoted line", async () => {
    await act("tap", "home", { ref: "e2" });
    expect(await act("type", "quoted", { ref: "e3", text: "Ana" })).toContain('Value of e3: "Ana"');
  });
  it("finds the value when the whole line is quoted", async () => {
    screens.quoted2 = `- 'textbox "a: b" [ref=e3]: Ana'`;
    await act("tap", "home", { ref: "e2" });
    expect(await act("type", "quoted2", { ref: "e3", text: "Ana" })).toContain('Value of e3: "Ana"');
  });
  it("says when the value is not shown", async () => {
    expect(await act("type", "gone", { ref: "e3", text: "Ana" })).toContain("Value of e3: not shown");
  });
  it("does not return an empty diff when lines only moved", async () => {
    await act("tap", "home", { ref: "e2" });
    const r = await act("tap", "reordered", { ref: "e1", compact: true });
    expect(r).toContain("(same lines, new order)");
  });
  it("does not claim new screen for a session this server never opened", async () => {
    step = "home";
    const call = async () => textOf(await c.callTool({ name: "tap", arguments: { session: "stranger", ref: "e2" } }));
    const first = await call();
    expect(first).not.toMatch(/new screen/);
    expect(first).toMatch(/^Change: unknown/);
    expect(await call()).toMatch(/^Change: none\n/);
  });
});

describe("delivery", () => {
  let c: Awaited<ReturnType<typeof connect>>;
  let reply: Record<string, unknown> = {};
  let last: any = null;
  beforeAll(async () => {
    fake.removeAllListeners("request");
    fake.on("request", async (req, res) => {
      let raw = ""; for await (const ch of req) raw += ch;
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/apps") return res.end(JSON.stringify({ ok: true, apps: [{ id: "menu" }] }));
      if (req.url === "/act") last = JSON.parse(raw);
      res.end(JSON.stringify(req.url === "/session" ? { ok: true, screen: '- button "Buy" [ref=e1]' } : { screen: '- button "Buy" [ref=e1]', ...reply }));
    });
    c = await connect();
  });
  afterAll(async () => { await c?.close(); });

  it("reports delivered with safe_to_retry false, the field value and the wait result", async () => {
    reply = { ok: true, delivery: "delivered", safe_to_retry: false, value: "Ana", wait_for: { matched: true, waited_ms: 120 }, settled: true };
    const r: any = await c.callTool({ name: "type", arguments: { session: "d", ref: "e3", text: "Ana", wait_for: { text: "Hi", timeout_ms: 900 }, settle: true } });
    expect(last).toMatchObject({ action: "type", wait_for: { text: "Hi", timeout_ms: 900 }, settle: true });
    expect(r.structuredContent).toEqual({ ok: true, delivery: "delivered", safe_to_retry: false, value: "Ana", wait_for: { matched: true, waited_ms: 120 }, settled: true });
    expect(textOf(r)).toContain("Delivery: delivered, safe_to_retry: false");
    expect(textOf(r)).toContain("Wait: happened after 120 ms");
    expect(textOf(r)).toContain('Value of e3: "Ana"');
  });
  it("reports a timed-out wait without an error", async () => {
    reply = { ok: true, delivery: "delivered", safe_to_retry: false, wait_for: { matched: false, waited_ms: 900 } };
    const r: any = await c.callTool({ name: "tap", arguments: { session: "d", ref: "e1", wait_for: { text: "Never" } } });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toContain("Wait: did not happen after 900 ms");
  });
  for (const [reason, safe] of [["stale_ref", true], ["not_visible", true], ["disabled", true], ["covered", true], ["timeout", false]] as const) {
    it(`reports not_delivered (${reason}) with safe_to_retry ${safe}`, async () => {
      reply = { ok: false, code: reason, error: `no: ${reason}`, delivery: "not_delivered", reason, safe_to_retry: safe };
      const r: any = await c.callTool({ name: "tap", arguments: { session: "d", ref: "e1" } });
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toMatchObject({ ok: false, code: reason, delivery: "not_delivered", reason, safe_to_retry: safe });
      expect(textOf(r)).toContain(`Delivery: not_delivered (${reason}), safe_to_retry: ${safe}`);
    });
  }
  it("rejects a wait_for with two targets", async () => {
    const r: any = await c.callTool({ name: "tap", arguments: { session: "d", ref: "e1", wait_for: { text: "a", ref: "e2" } } });
    expect(r.isError).toBe(true);
  });
});
