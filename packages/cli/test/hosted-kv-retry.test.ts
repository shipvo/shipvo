import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import { kv } from "../src/config.js";

let server: Server, port = 0, mode: "reset" | "flaky" | "401" | "ok" = "ok", hits = 0, lastBytes = 0;
const saved = { ...process.env };
const cfg = () => ({ appId: "app", name: "app", shellMajor: 1, controlPlane: `http://127.0.0.1:${port}`, publicKey: "k" });

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    if (mode === "reset" || (mode === "flaky" && hits === 1)) { req.destroy(); return; }
    if (mode === "401") { res.statusCode = 401; res.end("{}"); return; }
    let n = 0; req.on("data", (c) => (n += c.length)); req.on("end", () => { lastBytes = n; res.setHeader("content-type", "application/json"); res.end('{"ok":true}'); });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { server.close(); process.env = saved; });
beforeEach(() => { hits = 0; process.env.SHIPVO_PUBLISH_TOKEN = "t"; for (const k of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "SHIPVO_KV_ID", "PURENATIVE_KV_ID"]) delete process.env[k]; });

describe("hosted kv network errors", () => {
  it("names the key and the cause code after retrying", async () => {
    mode = "reset";
    await expect(kv(cfg()).put("p/app/1/b0", "x", "text/plain")).rejects.toThrow(/Cannot reach the control plane at http:\/\/127\.0\.0\.1:\d+ \(\w+\) while PUT p\/app\/1\/b0.*shipvo doctor/);
    expect(hits).toBe(3);
  });
  it("a PUT that fails once then succeeds works", async () => {
    mode = "flaky";
    await kv(cfg()).put("b/app/x", "x", "text/plain");
    expect(hits).toBe(2);
  });
  it("does not retry a 401", async () => {
    mode = "401";
    await expect(kv(cfg()).put("b/app/x", "x", "text/plain")).rejects.toThrow(/rejected your publish token \(401\)/);
    expect(hits).toBe(1);
  });
  it("uploads a 2 MB bundle", async () => {
    mode = "ok";
    await kv(cfg()).put("b/app/big", new Uint8Array(2 * 1024 * 1024 + 5), "application/octet-stream");
    expect(lastBytes).toBe(2 * 1024 * 1024 + 5);
  });
});
