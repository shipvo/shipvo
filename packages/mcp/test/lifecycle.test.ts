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
const seen: string[] = [];
let locked = false;

// A fake simulator with the lock rules of the real one: typed errors for repeated lock and unlock.
beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url !== "/act") return res.end(JSON.stringify({ ok: true }));
    seen.push(body.action);
    if (body.action === "lock") { if (locked) return res.end(JSON.stringify({ ok: false, code: "already_locked", error: "the phone is already locked.", screen: "Lock" })); locked = true; return res.end(JSON.stringify({ ok: true, screen: "Swipe up to unlock" })); }
    if (body.action === "unlock") { if (!locked) return res.end(JSON.stringify({ ok: false, code: "not_locked", error: "the phone is not locked.", screen: "Home" })); locked = false; return res.end(JSON.stringify({ ok: true, screen: "Home" })); }
    if (body.action === "restart") { locked = false; return res.end(JSON.stringify({ ok: true, screen: "Loads: 2" })); }
    res.end(JSON.stringify({ ok: true, screen: "" }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
});
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

describe("lock, unlock, restart", () => {
  it("are listed, reach the simulator and return typed errors", async () => {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${port}`, PN_CONTROL: "http://127.0.0.1:1" };
    delete env.PN_APPS;
    const c = new Client({ name: "test", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
    const names = (await c.listTools()).tools.map((t) => t.name);
    for (const n of ["lock", "unlock", "restart"]) expect(names).toContain(n);
    const call = (name: string): Promise<any> => c.callTool({ name, arguments: { session: "s" } });
    const e1: any = await call("unlock");
    expect(e1.isError).toBe(true); expect(e1.structuredContent.code).toBe("not_locked");
    const l: any = await call("lock");
    expect(l.isError).toBeUndefined(); expect(l.content[0].text).toMatch(/Swipe up/);
    const e2: any = await call("lock");
    expect(e2.isError).toBe(true); expect(e2.structuredContent.code).toBe("already_locked");
    expect((await call("unlock") as any).isError).toBeUndefined();
    const r: any = await call("restart");
    expect(r.content[0].text).toMatch(/Loads: 2/);
    expect(seen).toEqual(["unlock", "lock", "lock", "unlock", "restart"]);
    await c.close();
  });
});
