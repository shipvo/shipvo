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

// Tools that take no session, so an unknown session id does not apply. Every other registered tool must.
const NO_SESSION: Record<string, string> = {
  list_apps: "lists apps, takes no session",
  open_app: "creates a session",
  publish_preview: "builds the app folder, takes no session",
  owner_describe: "owner tool, works on an app",
  owner_command: "owner tool, works on an app",
  approvals_list: "owner tool, works on an app",
  approval_approve: "owner tool, works on an app",
  list_sessions: "lists all sessions, takes no session id",
  record_start: "records the phone frame page, takes no session id",
  record_marker: "adds a chapter to the running recording, takes no session id",
  record_stop: "ends the running recording, takes no session id",
};

// A simulator with no sessions at all.
beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    res.writeHead(200, { "content-type": "application/json" });
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/sessions") return res.end(JSON.stringify({ ok: true, sessions: [] }));
    if (req.url === "/act") return res.end(JSON.stringify({ ok: false, code: "no_session", error: `no session '${body.session}': call /session first`, screen: null }));
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
});
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

// A minimal valid value for each required input, built from the tool's own schema.
function sample(s: any): unknown {
  if (s?.enum) return s.enum[0];
  if (s?.pattern) return "e1"; // the only pattern in use is the element ref, ^e\d+$
  switch (s?.type) {
    case "number": case "integer": return 1;
    case "boolean": return true;
    case "array": return [];
    case "object": return {};
    default: return "x";
  }
}

describe("every session tool", () => {
  it("returns isError, a non-null code and a plain message for an unknown session", async () => {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${port}`, PN_CONTROL: "http://127.0.0.1:1" };
    delete env.PN_APPS;
    const c = new Client({ name: "test", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
    const { tools } = await c.listTools();
    const names = tools.map((t) => t.name);
    for (const n of Object.keys(NO_SESSION)) expect(names, `allow-list names a tool that is not registered: ${n}`).toContain(n);
    const session = tools.filter((t) => !(t.name in NO_SESSION));
    expect(session.length).toBeGreaterThan(5);
    const bad: string[] = [];
    for (const t of session) {
      const props = (t.inputSchema.properties ?? {}) as Record<string, any>;
      if (!props.session) { bad.push(`${t.name}: not in the allow-list and has no session input`); continue; }
      const args: Record<string, unknown> = {};
      for (const k of t.inputSchema.required ?? []) args[k] = sample(props[k]);
      args.session = "ghost";
      const r: any = await c.callTool({ name: t.name, arguments: args });
      const code = r.structuredContent?.code;
      if (r.isError !== true || typeof code !== "string" || !code || typeof r.structuredContent?.error !== "string" || !r.structuredContent.error) bad.push(`${t.name}: isError=${r.isError} code=${JSON.stringify(code)}`);
    }
    await c.close();
    expect(bad).toEqual([]);
  });
});
