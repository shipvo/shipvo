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
const live = new Map<string, { app: string; room: string | null }>();
const ended: string[] = [];

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/apps") return res.end(JSON.stringify({ ok: true, apps: [{ id: "tide", name: "Tide" }] }));
    if (req.url === "/session") { live.set(body.session, { app: "tide", room: body.room ?? null }); return res.end(JSON.stringify({ ok: true, app: "tide", release: "local", screen: '- heading "Shop"' })); }
    if (req.url === "/sessions") return res.end(JSON.stringify({ ok: true, sessions: [...live].map(([session, s]) => ({ session, app: s.app, release: "local", started_at: "2026-11-07T10:00:00.000Z", room: s.room, title: "Shop" })) }));
    if (req.url === "/end") { ended.push(body.session); live.delete(body.session); return res.end(JSON.stringify({ ok: true, ended: true })); }
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
});
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

describe("rooms", () => {
  it("open_app passes room, list_sessions shows it, end_session reports per session", async () => {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${port}`, PN_CONTROL: "http://127.0.0.1:1" };
    delete env.PN_APPS;
    const c = new Client({ name: "room-test-client", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
    for (const [session, room] of [["a", "r1"], ["b", "r1"], ["c", undefined]] as const) {
      const r: any = await c.callTool({ name: "open_app", arguments: { app: "tide", session, attach: "never", ...(room ? { room } : {}) } });
      expect(r.isError).toBeFalsy();
    }
    const l: any = await c.callTool({ name: "list_sessions", arguments: {} });
    const rows = l.structuredContent.sessions;
    expect(rows.map((s: any) => [s.session, s.room]).sort()).toEqual([["a", "r1"], ["b", "r1"], ["c", null]]);
    expect(rows[0]).toMatchObject({ app: "tide", platform: "headless", opened_by: "room-test-client", screen_title: "Shop" });
    expect(l.content[0].text).toContain("room r1");
    const e: any = await c.callTool({ name: "end_session", arguments: { session: "a" } });
    expect(JSON.parse(e.content[0].text)).toMatchObject({ session: "a", room: "r1" });
    expect(ended).toEqual(["a"]);
    await c.close();
  }, 30000);
});

describe("room log, notes and report", () => {
  it("logs actions and notes in order with cursors; the report covers the room only", async () => {
    const act: any = { ok: true, screen: '- heading "Shop"\n- button "Add" [ref=e1]' };
    let n = 0;
    const srv = http.createServer(async (req, res) => {
      let raw = ""; for await (const c of req) raw += c;
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/session") return res.end(JSON.stringify({ ok: true, app: "tide", release: "local", screen: act.screen }));
      if (req.url === "/act") return res.end(JSON.stringify({ ...act, screen: act.screen + `\n- text "n${++n}"` }));
      if (req.url === "/sessions") return res.end(JSON.stringify({ ok: true, sessions: [] }));
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((r) => srv.listen(0, r));
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${(srv.address() as any).port}`, PN_CONTROL: "http://127.0.0.1:1" };
    delete env.PN_APPS;
    const c = new Client({ name: "lead", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
    const call = (name: string, args: any): Promise<any> => c.callTool({ name, arguments: args });
    await call("open_app", { app: "tide", session: "buyer", attach: "never", room: "t1" });
    await call("open_app", { app: "tide", session: "owner", attach: "never", room: "t1" });
    await call("open_app", { app: "tide", session: "other", attach: "never", room: "t2" });
    await call("tap", { session: "buyer", ref: "e1" });
    await call("room_note", { room: "t1", session: "buyer", text: "Buyer: order placed, id 42" });
    await call("room_note", { room: "t1", session: "owner", text: "Finding: total is wrong" });
    await call("tap", { session: "other", ref: "e1" });
    const first = (await call("room_log", { room: "t1" })).structuredContent;
    expect(first.entries.map((e: any) => [e.session, e.tool])).toEqual([["buyer", "open_app"], ["owner", "open_app"], ["buyer", "tap"], ["buyer", "room_note"], ["owner", "room_note"]]);
    expect(first.entries.map((e: any) => e.n)).toEqual([1, 2, 3, 4, 5]);
    expect(first.entries[2]).toMatchObject({ agent: "lead", target: 'button "Add" [e1]', change: "content changed" });
    expect(first.entries[3].text).toBe("Buyer: order placed, id 42");
    expect(first.cursor).toBe(5);
    await call("tap", { session: "owner", ref: "e1" });
    const next = (await call("room_log", { room: "t1", since: first.cursor })).structuredContent;
    expect(next.entries.map((e: any) => [e.n, e.session, e.tool])).toEqual([[6, "owner", "tap"]]);
    const rep = (await call("room_report", { room: "t1" })).structuredContent;
    expect(rep.sessions.map((s: any) => s.session).sort()).toEqual(["buyer", "owner"]);
    const buyer = rep.sessions.find((s: any) => s.session === "buyer");
    expect(buyer).toMatchObject({ steps: 2, errors: 0, last_screen: "Shop", notes: ["Buyer: order placed, id 42"], findings: [] });
    expect(rep.sessions.find((s: any) => s.session === "owner").findings).toEqual(["Finding: total is wrong"]);
    expect((await call("room_log", { room: "bad room" })).isError).toBe(true);
    await c.close(); srv.close();
  }, 30000);
});
