import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(__dirname, "..");
let out = ""; let fake: http.Server; let port = 0;
const posts: string[] = []; const bodies: string[] = [];

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  // a stand-in simulator that serves the scaffolded app "menu"
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    posts.push(req.url ?? ""); bodies.push(raw);
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
  it("set_device accepts contacts and passes them to the simulator", async () => {
    const c = await connect();
    const contacts = [{ id: "1", name: "Amina Njoya", phoneNumbers: ["+237655001122"] }];
    const r: any = await c.callTool({ name: "set_device", arguments: { session: "menu-1", contacts, permissions: { contacts: "denied" } } });
    expect(r.isError).toBeFalsy();
    const sent = JSON.parse(bodies.filter((b) => b.includes('"set_device"')).at(-1)!);
    expect(sent.device).toEqual({ contacts, permissions: { contacts: "denied" } });
    await c.close();
  });

  it("set_device accepts calendar events and passes them to the simulator", async () => {
    const c = await connect();
    const calendar = [{ id: "e1", title: "Dentist", start: "2026-11-10T09:00:00Z", end: "2026-11-10T10:00:00Z" }];
    const r: any = await c.callTool({ name: "set_device", arguments: { session: "menu-1", calendar, permissions: { calendar: "granted" } } });
    expect(r.isError).toBeFalsy();
    const sent = JSON.parse(bodies.filter((b) => b.includes('"set_device"')).at(-1)!);
    expect(sent.device).toEqual({ calendar, permissions: { calendar: "granted" } });
    await c.close();
  });

  it("set_device accepts files and passes them to the simulator", async () => {
    const c = await connect();
    const files = [{ name: "a.pdf", mimeType: "application/pdf", content: "x" }];
    const r: any = await c.callTool({ name: "set_device", arguments: { session: "menu-1", files } });
    expect(r.isError).toBeFalsy();
    const sent = JSON.parse(bodies.filter((b) => b.includes('"set_device"')).at(-1)!);
    expect(sent.device).toEqual({ files });
    await c.close();
  });

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

describe("approvals tools", () => {
  let control: http.Server; const seen: { method?: string; url?: string; headers: http.IncomingHttpHeaders }[] = [];
  beforeAll(async () => {
    control = http.createServer((req, res) => {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      res.writeHead(req.url?.includes("/bad/") ? 403 : 200, { "content-type": "application/json" });
      if (req.url?.includes("/bad/")) return res.end(JSON.stringify({ error: "self_approval", rule: "self_approval", message: "cannot approve" }));
      if (req.method === "GET") return res.end(JSON.stringify({ approvals: [{ id: "h1", release: 7, band: "b2", proposer: "ann", proposed_at: new Date(Date.now() - 120000).toISOString() }] }));
      res.end(JSON.stringify({ ok: true, approval_id: "h1", status: "approved" }));
    });
    await new Promise<void>((r) => control.listen(0, r));
  });
  afterAll(() => control?.close());
  const url = () => `http://127.0.0.1:${(control.address() as { port: number }).port}`;
  it("lists holds with id, release, band, proposer and age", async () => {
    const c = await connect({ PN_CONTROL: url(), PN_OWNER_TOKEN: "t" });
    const r: any = await c.callTool({ name: "approvals_list", arguments: { app: "menu" } });
    expect(r.structuredContent.approvals[0]).toMatchObject({ id: "h1", release: 7, band: "b2", proposer: "ann" });
    expect(r.structuredContent.approvals[0].age_seconds).toBeGreaterThanOrEqual(120);
    expect(seen.at(-1)).toMatchObject({ method: "GET", url: "/apps/menu/approvals" });
    await c.close();
  });
  it("approves as an agent and surfaces a refusal with the rule named", async () => {
    const c = await connect({ PN_CONTROL: url(), PN_OWNER_TOKEN: "t" });
    const ok: any = await c.callTool({ name: "approval_approve", arguments: { app: "menu", id: "h1" } });
    expect(JSON.parse(ok.content[0].text)).toMatchObject({ ok: true, status: "approved" });
    expect(seen.at(-1)).toMatchObject({ method: "POST", url: "/apps/menu/approvals/h1/approve" });
    expect(seen.at(-1)!.headers["x-shipvo-actor"]).toBe("agent");
    const no: any = await c.callTool({ name: "approval_approve", arguments: { app: "menu", id: "bad" } });
    expect(no.isError).toBe(true); expect(JSON.parse(no.content[0].text)).toMatchObject({ ok: false, rule: "self_approval" });
    await c.close();
  });
  it("needs an owner token", async () => {
    const c = await connect({ PN_CONTROL: url() });
    const r: any = await c.callTool({ name: "approvals_list", arguments: { app: "menu" } });
    expect(r.isError).toBe(true);
    await c.close();
  });
});

describe("owner_command confirm", () => {
  let control: http.Server; const seen: { headers: http.IncomingHttpHeaders; body: any }[] = [];
  beforeAll(async () => {
    control = http.createServer(async (req, res) => {
      let raw = ""; for await (const c of req) raw += c;
      seen.push({ headers: req.headers, body: JSON.parse(raw || "{}") });
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((r) => control.listen(0, r));
  });
  afterAll(() => control?.close());
  const url = () => `http://127.0.0.1:${(control.address() as { port: number }).port}`;
  it("passes confirm and the shipvo.json agent rules to the control plane", async () => {
    const dir = mkdtempSync(join(root, "dist-test-app-"));
    writeFileSync(join(dir, "shipvo.json"), JSON.stringify({ agentPolicy: "deny", agentDeny: ["set_theme", "publish"] }));
    try {
      const c = await connect({ PN_CONTROL: url(), PN_OWNER_TOKEN: "t", PN_APP_DIR: dir });
      await c.callTool({ name: "owner_command", arguments: { app: "menu", command: "publish", args: { note: "x" }, confirm: true } });
      await c.callTool({ name: "owner_command", arguments: { app: "menu", command: "publish", args: { note: "x" } } });
      expect(seen[0]!.body).toEqual({ name: "publish", args: { note: "x", confirm: true } });
      expect(seen[0]!.headers["x-shipvo-agent-policy"]).toBe("deny");
      expect(seen[0]!.headers["x-shipvo-agent-deny"]).toBe("set_theme,publish");
      expect(seen[1]!.body.args).toEqual({ note: "x" });
      await c.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("ignores confirm inside args unless the top-level confirm is true", async () => {
    const c = await connect({ PN_CONTROL: url(), PN_OWNER_TOKEN: "t" });
    const n = seen.length;
    await c.callTool({ name: "owner_command", arguments: { app: "menu", command: "publish", args: { note: "x", confirm: true } } });
    expect(seen[n]!.body.args).toEqual({ note: "x" });
    await c.close();
  });
});
