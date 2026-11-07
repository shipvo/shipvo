import { describe, expect, it } from "vitest";
import http from "node:http";
import { postHostedBuild, simHosted } from "../src/sim-hosted.js";

const serve = (status: number, body: unknown) => new Promise<{ url: string; close: () => void }>((ok) => {
  const s = http.createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }); });
  s.listen(0, () => ok({ url: `http://localhost:${(s.address() as { port: number }).port}`, close: () => s.close() }));
});

describe("shipvo sim --hosted upload", () => {
  it("returns the build id and expiry", async () => {
    const s = await serve(201, { id: "b1", expires_at: "2026-11-08T00:00:00Z", bytes: 3 });
    expect(await postHostedBuild({ url: s.url, key: "k", app: "menu", body: Buffer.from("abc") })).toEqual({ id: "b1", expires_at: "2026-11-08T00:00:00Z", bytes: 3 });
    s.close();
  });
  it("a too-large build keeps the service's advice on making it smaller", async () => {
    const s = await serve(413, { code: "build_too_large", message: "Make it smaller: remove unused images." });
    await expect(postHostedBuild({ url: s.url, key: "k", app: "menu", body: Buffer.from("abc") })).rejects.toMatchObject({ code: "build_too_large", message: expect.stringContaining("smaller") });
    s.close();
  });
  it("a rejected key says to log in again", async () => {
    const s = await serve(401, { error: "invalid_api_key" });
    await expect(postHostedBuild({ url: s.url, key: "k", app: "menu", body: Buffer.from("abc") })).rejects.toMatchObject({ code: "unauthorized" });
    s.close();
  });
  it("simHosted without a key fails with no_api_key before building anything", async () => {
    const old = { k: process.env.SHIPVO_API_KEY, h: process.env.SHIPVO_HOME };
    delete process.env.SHIPVO_API_KEY; process.env.SHIPVO_HOME = "/nonexistent-shipvo-home";
    try { await expect(simHosted("menu")).rejects.toMatchObject({ code: "no_api_key", message: expect.stringContaining("shipvo login") }); }
    finally { if (old.k !== undefined) process.env.SHIPVO_API_KEY = old.k; if (old.h === undefined) delete process.env.SHIPVO_HOME; else process.env.SHIPVO_HOME = old.h; }
  });
});
