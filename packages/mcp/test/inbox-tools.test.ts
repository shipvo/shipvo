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
const seen: any[] = [];
const MAIL = { id: "m1", from: "a@x.test", to: "s-1@inbox.shipvo.test", subject: "Code", text: "Your code is 123456", codes: ["123456"], links: [], received_at: "t" };

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/act") {
      if (body.action !== "pending_banner") seen.push(body);
      if (body.action === "inbox_read") return res.end(JSON.stringify({ ok: true, address: MAIL.to, messages: [MAIL] }));
      if (body.action === "inbox_wait") return res.end(JSON.stringify(body.subject === "never" ? { ok: false, code: "inbox_timeout", error: "no mail arrived within 100 ms" } : { ok: true, address: MAIL.to, message: MAIL }));
      if (body.action === "inbox_clear") return res.end(JSON.stringify({ ok: true, cleared: 1 }));
    }
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
});
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

describe("inbox tools", () => {
  it("are listed, pass filters to the simulator and give a typed timeout", async () => {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${port}`, PN_CONTROL: "http://127.0.0.1:1" };
    const c = new Client({ name: "inbox-test", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
    const names = (await c.listTools()).tools.map((t) => t.name);
    for (const n of ["inbox_wait", "inbox_read", "inbox_clear"]) expect(names).toContain(n);
    const w: any = await c.callTool({ name: "inbox_wait", arguments: { session: "s", subject: "Code", timeout_ms: 500 } });
    expect(JSON.parse(w.content[0].text).message.codes).toEqual(["123456"]);
    expect(seen.at(-1)).toMatchObject({ action: "inbox_wait", session: "s", subject: "Code", timeout_ms: 500 });
    const one: any = await c.callTool({ name: "inbox_read", arguments: { session: "s" } });
    const two: any = await c.callTool({ name: "inbox_read", arguments: { session: "s" } });
    expect(two.content[0].text).toBe(one.content[0].text);
    expect(JSON.parse(one.content[0].text).messages[0]).toMatchObject({ subject: "Code", text: "Your code is 123456", codes: ["123456"], links: [] });
    const t: any = await c.callTool({ name: "inbox_wait", arguments: { session: "s", subject: "never" } });
    expect(t.isError).toBe(true); expect(t.structuredContent.code).toBe("inbox_timeout");
    expect(JSON.parse(((await c.callTool({ name: "inbox_clear", arguments: { session: "s" } })) as any).content[0].text)).toEqual({ cleared: 1 });
    await c.close();
  }, 30000);
});

describe("pending banner", () => {
  it("starts a tool result with the pending line for the calling assistant, and adds nothing when none waits", async () => {
    const asked: any[] = [];
    let banner = "Inbox: 2 unread for chatgpt, 1 task open";
    const srv = http.createServer(async (req, res) => {
      let raw = ""; for await (const c of req) raw += c;
      const body = raw ? JSON.parse(raw) : {};
      res.writeHead(200, { "content-type": "application/json" });
      if (body.action === "pending_banner") { asked.push(body); return res.end(JSON.stringify({ ok: true, banner })); }
      if (body.action === "inbox_clear") return res.end(JSON.stringify({ ok: true, cleared: 0 }));
      res.end(JSON.stringify({ ok: true, screen: "Home" }));
    });
    await new Promise<void>((r) => srv.listen(0, r));
    const p = (srv.address() as { port: number }).port;
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${p}`, PN_CONTROL: "http://127.0.0.1:1" };
    const c = new Client({ name: "openai-mcp", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
    const r: any = await c.callTool({ name: "inbox_clear", arguments: { session: "s" } });
    expect(r.content[0].text).toBe(`${banner}\n{"cleared":0}`);
    expect(asked.at(-1)).toMatchObject({ session: "s", agent: "openai-mcp" });
    banner = "";
    const q: any = await c.callTool({ name: "inbox_clear", arguments: { session: "s" } });
    expect(q.content[0].text).toBe('{"cleared":0}');
    await c.close(); srv.close();
  }, 30000);
});

describe("wait_for_event", () => {
  it("passes the wait to the simulator and says plainly whether something is waiting", async () => {
    const seen: any[] = [];
    let event = true;
    const srv = http.createServer(async (req, res) => {
      let raw = ""; for await (const c of req) raw += c;
      const body = raw ? JSON.parse(raw) : {};
      res.writeHead(200, { "content-type": "application/json" });
      if (body.action === "pending_banner") return res.end(JSON.stringify({ ok: true, banner: "" }));
      seen.push(body);
      res.end(JSON.stringify(event ? { ok: true, event: true, banner: "Inbox: 1 unread for claude", pending: { messages: ["m1"], tasks: [] } } : { ok: true, event: false }));
    });
    await new Promise<void>((r) => srv.listen(0, r));
    const p = (srv.address() as { port: number }).port;
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${p}`, PN_CONTROL: "http://127.0.0.1:1" };
    const c = new Client({ name: "claude-ai", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
    const hit: any = await c.callTool({ name: "wait_for_event", arguments: { session: "s", timeout_ms: 1000 } });
    expect(hit.content[0].text).toBe("Something is waiting for you. Read it with check_inbox or my_tasks.");
    expect(hit.structuredContent).toEqual({ event: true, pending: { messages: ["m1"], tasks: [] } });
    expect(seen.at(-1)).toMatchObject({ action: "wait_for_event", session: "s", timeout_ms: 1000 });
    event = false;
    const none: any = await c.callTool({ name: "wait_for_event", arguments: { session: "s" } });
    expect(none.content[0].text).toBe("nothing yet");
    expect(none.structuredContent).toEqual({ event: false });
    await c.close(); srv.close();
  }, 30000);
});

describe("wake-up tools", () => {
  it("pass the registration to the simulator and return the secret once", async () => {
    const seen: any[] = [];
    const srv = http.createServer(async (req, res) => {
      let raw = ""; for await (const c of req) raw += c;
      const body = raw ? JSON.parse(raw) : {};
      res.writeHead(200, { "content-type": "application/json" });
      if (body.action === "pending_banner") return res.end(JSON.stringify({ ok: true, banner: "" }));
      seen.push(body);
      if (body.action === "register_wakeup") return res.end(JSON.stringify(body.url.includes("127.") ? { ok: false, code: "host_not_allowed", error: "127.0.0.1 is a private host" } : { ok: true, wakeup: { name: body.name, url: body.url, events: body.events ?? ["message", "task"], secret: "abc" } }));
      if (body.action === "list_wakeups") return res.end(JSON.stringify({ ok: true, wakeups: [{ name: "claude", url: "https://example.com/h", events: ["task"] }] }));
      res.end(JSON.stringify({ ok: true, cleared: true }));
    });
    await new Promise<void>((r) => srv.listen(0, r));
    const p = (srv.address() as { port: number }).port;
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${p}`, PN_CONTROL: "http://127.0.0.1:1" };
    const c = new Client({ name: "claude-ai", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
    const names = (await c.listTools()).tools.map((t) => t.name);
    for (const n of ["register_wakeup", "list_wakeups", "clear_wakeup"]) expect(names).toContain(n);
    const ok: any = await c.callTool({ name: "register_wakeup", arguments: { session: "s", name: "chatgpt", url: "https://example.com/h", events: ["message"], format: "text" } });
    expect(JSON.parse(ok.content[0].text)).toEqual({ name: "chatgpt", url: "https://example.com/h", events: ["message"], secret: "abc" });
    expect(seen.at(-1)).toMatchObject({ action: "register_wakeup", session: "s", name: "chatgpt", url: "https://example.com/h", events: ["message"], format: "text" });
    const bad: any = await c.callTool({ name: "register_wakeup", arguments: { session: "s", name: "x", url: "http://127.0.0.1:9/h" } });
    expect(bad.isError).toBe(true); expect(bad.content[0].text).toContain("host_not_allowed");
    const l: any = await c.callTool({ name: "list_wakeups", arguments: { session: "s" } });
    expect(JSON.parse(l.content[0].text).wakeups[0].name).toBe("claude");
    const k: any = await c.callTool({ name: "clear_wakeup", arguments: { session: "s", name: "claude" } });
    expect(JSON.parse(k.content[0].text)).toEqual({ cleared: true });
    await c.close(); srv.close();
  }, 30000);

  it("search_phone passes the query on and returns the hits", async () => {
    const seen: any[] = [];
    const srv = http.createServer(async (req, res) => {
      let raw = ""; for await (const c of req) raw += c;
      const body = raw ? JSON.parse(raw) : {};
      res.writeHead(200, { "content-type": "application/json" });
      if (body.action === "pending_banner") return res.end(JSON.stringify({ ok: true, banner: "" }));
      seen.push(body);
      res.end(JSON.stringify({ ok: true, query: body.query, count: 1, truncated: false, results: [{ kind: "row", app: "contacts", collection: "people", id: "p1", field: "name", snippet: "Amina Diallo" }] }));
    });
    await new Promise<void>((r) => srv.listen(0, r));
    const p = (srv.address() as { port: number }).port;
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${p}`, PN_CONTROL: "http://127.0.0.1:1" };
    const c = new Client({ name: "claude-ai", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
    expect((await c.listTools()).tools.map((t) => t.name)).toContain("search_phone");
    const r: any = await c.callTool({ name: "search_phone", arguments: { session: "s", query: "amina", app: "contacts", limit: 5 } });
    expect(seen.at(-1)).toMatchObject({ action: "search_phone", session: "s", query: "amina", app: "contacts", limit: 5 });
    const out2 = JSON.parse(r.content[0].text);
    expect(out2.count).toBe(1); expect(out2.results[0].snippet).toBe("Amina Diallo");
    await c.close(); srv.close();
  }, 30000);

  it("get_connectivity and set_connectivity pass the switches on and return the network", async () => {
    const seen: any[] = [];
    const srv = http.createServer(async (req, res) => {
      let raw = ""; for await (const c of req) raw += c;
      const body = raw ? JSON.parse(raw) : {};
      res.writeHead(200, { "content-type": "application/json" });
      if (body.action === "pending_banner") return res.end(JSON.stringify({ ok: true, banner: "" }));
      seen.push(body);
      if (body.action === "set_connectivity" && body.mobile_data === true) return res.end(JSON.stringify({ ok: false, code: "airplane_on", error: "mobile data stays off in airplane mode" }));
      res.end(JSON.stringify({ ok: true, connectivity: { wifi: false, mobile_data: false, airplane: true, online: false, type: "none" } }));
    });
    await new Promise<void>((r) => srv.listen(0, r));
    const p = (srv.address() as { port: number }).port;
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${p}`, PN_CONTROL: "http://127.0.0.1:1" };
    const c = new Client({ name: "claude-ai", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
    const s: any = await c.callTool({ name: "set_connectivity", arguments: { session: "s", airplane: true } });
    expect(seen.at(-1)).toMatchObject({ action: "set_connectivity", session: "s", airplane: true });
    expect(JSON.parse(s.content[0].text)).toEqual({ wifi: false, mobile_data: false, airplane: true, online: false, type: "none" });
    const g: any = await c.callTool({ name: "get_connectivity", arguments: { session: "s" } });
    expect(JSON.parse(g.content[0].text).online).toBe(false);
    const bad: any = await c.callTool({ name: "set_connectivity", arguments: { session: "s", mobile_data: true } });
    expect(bad.isError).toBe(true); expect(bad.content[0].text).toContain("airplane_on");
    await c.close(); srv.close();
  }, 30000);
});
