import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(__dirname, "..");
const SECRET = "rk_live_SUPERSECRETVALUE1234567890";
let out = ""; let fake: http.Server; let port = 0;
const seen: string[] = [];

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  // A control plane that has the secret stored and, to prove the point, would leak it if a tool passed fields through.
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    seen.push(`${req.method} ${req.url} ${raw}`);
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== "Bearer good") { res.writeHead(401); return res.end("{}"); }
    if (req.url === "/vault/tickets" && raw.includes('"service":"nope"')) { res.writeHead(400); return res.end(JSON.stringify({ error: "bad_service", message: "Use a known service name or the service's domain." })); }
    if (req.url === "/vault/tickets" && raw.includes('"service":"noturl"')) { res.writeHead(201); return res.end(JSON.stringify({ ticket: "vt_x" })); }
    if (req.url === "/vault/tickets") { res.writeHead(201); return res.end(JSON.stringify({ ticket: "vt_x", url: "http://cp/vault/t/vt_x", expires_in: 600, value: SECRET })); }
    if (req.url === "/vault/status/tide/STRIPE_KEY") return res.end(JSON.stringify({ saved: true, valid: true, access: "read", value: SECRET, ciphertext: SECRET }));
    if (req.url === "/vault/status/tide/BAD") { res.writeHead(400); return res.end(JSON.stringify({ error: "bad_request", detail: SECRET })); }
    res.writeHead(500); res.end(JSON.stringify({ error: SECRET }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
});
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

async function connect(token: string) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: "http://127.0.0.1:1", PN_CONTROL: `http://127.0.0.1:${port}`, PN_OWNER_TOKEN: token };
  delete env.PN_APPS;
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
  return c;
}

describe("vault tools", () => {
  it("request_secret returns the link and a notice, and no value", async () => {
    const c = await connect("good");
    const r: any = await c.callTool({ name: "request_secret", arguments: { app: "tide", name: "STRIPE_KEY", purpose: "read orders", service: "stripe" } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.url).toBe("http://cp/vault/t/vt_x");
    expect(r.structuredContent.notice).toBe("Open this link to add your key. Shipvo does not show it to the assistant.");
    expect(JSON.stringify(r)).not.toContain(SECRET);
    await c.close();
  });
  it("secret_status returns only saved, valid and access", async () => {
    const c = await connect("good");
    const r: any = await c.callTool({ name: "secret_status", arguments: { app: "tide", name: "STRIPE_KEY" } });
    expect(r.structuredContent).toEqual({ saved: true, valid: true, access: "read" });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    await c.close();
  });
  it("no tool output or error contains the stored value", async () => {
    const c = await connect("good");
    const bad = await connect("wrong");
    const results = [
      await c.callTool({ name: "secret_status", arguments: { app: "tide", name: "BAD" } }),
      await c.callTool({ name: "secret_status", arguments: { app: "tide", name: "OTHER" } }),
      await bad.callTool({ name: "secret_status", arguments: { app: "tide", name: "STRIPE_KEY" } }),
      await bad.callTool({ name: "request_secret", arguments: { app: "tide", name: "STRIPE_KEY", purpose: "x" } }),
    ];
    for (const r of results) { expect((r as any).isError).toBe(true); expect(JSON.stringify(r)).not.toContain(SECRET); }
    expect(JSON.stringify(results[1])).not.toContain("request_secret again");
    expect(JSON.stringify(await c.callTool({ name: "request_secret", arguments: { app: "tide", name: "OTHER", purpose: "x", service: "stripe" } }))).not.toContain(SECRET);
    await c.close(); await bad.close();
  });
  it("request_secret without service is refused by the schema", async () => {
    const c = await connect("good");
    const n = seen.length;
    const r: any = await c.callTool({ name: "request_secret", arguments: { app: "tide", name: "STRIPE_KEY", purpose: "x" } }).catch((e) => ({ isError: true, thrown: String(e) }));
    expect(r.isError).toBe(true);
    expect(seen.length).toBe(n);
    await c.close();
  });
  it("request_secret without access sends the POST with access omitted", async () => {
    const c = await connect("good");
    await c.callTool({ name: "request_secret", arguments: { app: "tide", name: "STRIPE_KEY", purpose: "p", service: "stripe" } });
    const last = seen[seen.length - 1];
    expect(last).toContain("POST /vault/tickets");
    expect(last).not.toContain('"access"');
    await c.close();
  });
  it("a 400 bad_service keeps its code and the route's message", async () => {
    const c = await connect("good");
    const r: any = await c.callTool({ name: "request_secret", arguments: { app: "tide", name: "K", purpose: "x", service: "nope" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.code).toBe("bad_service");
    expect(r.structuredContent.error).toBe("Use a known service name or the service's domain.");
    await c.close();
  });
  it("a ticket answer without a link is an error, not 'undefined'", async () => {
    const c = await connect("good");
    const r: any = await c.callTool({ name: "request_secret", arguments: { app: "tide", name: "K", purpose: "x", service: "noturl" } });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r)).not.toContain("undefined");
    await c.close();
  });
});
