import { describe, it, expect } from "vitest";
import app from "../src/index";

const kv = (m: Record<string, any>) => ({ get: async (k: string, t?: string) => (k in m ? (t === "arrayBuffer" ? new TextEncoder().encode(m[k]).buffer : m[k]) : null) }) as any;
const h = "a".repeat(64);
const body = { schema_version: "1.0", app_id: "tide", shell_major: 1, band: "b0", release: 3, issued_at: "2026-10-30T00:00:00Z",
  core: { version: "1.0.0", sha256: h, size: 10, url: "c" }, min_shell_version: "1.0.0" };
const envl = JSON.stringify({ body: JSON.stringify(body), signature: "AAAA" });

describe("control plane", () => {
  it("health", async () => expect((await app.request("/health", {}, { POINTERS: kv({}) } as any)).status).toBe(200));
  it("serves envelope with etag and 304", async () => {
    const env = { POINTERS: kv({ "p/tide/1/b0": envl }) } as any;
    const r = await app.request("/p/tide/1/b0.json", {}, env);
    expect(r.status).toBe(200); expect(r.headers.get("etag")).toBe('"3"');
    expect((await app.request("/p/tide/1/b0.json", { headers: { "if-none-match": '"3"' } }, env)).status).toBe(304);
  });
  it("serves iOS pointers from their own key, never the Android one", async () => {
    const ios = JSON.stringify({ body: JSON.stringify({ ...body, platform: "ios", release: 7 }), signature: "AAAA" });
    const env = { POINTERS: kv({ "p/tide/1/b0": envl, "p/tide/1/ios/b0": ios }) } as any;
    const r = await app.request("/p/tide/1/ios/b0.json", {}, env);
    expect(r.status).toBe(200); expect(r.headers.get("etag")).toBe('"7"');
    expect((await app.request("/p/tide/1/b0.json", {}, env)).headers.get("etag")).toBe('"3"');
    expect((await app.request("/p/tide/1/ios/b0.json", {}, { POINTERS: kv({ "p/tide/1/b0": envl }) } as any)).status).toBe(404);
  });
  it("404, 400 and corrupt", async () => {
    expect((await app.request("/p/tide/1/b0.json", {}, { POINTERS: kv({}) } as any)).status).toBe(404);
    expect((await app.request("/p/tide/1/zz.json", {}, { POINTERS: kv({}) } as any)).status).toBe(400);
    expect((await app.request("/p/tide/1/b0.json", {}, { POINTERS: kv({ "p/tide/1/b0": "{}" }) } as any)).status).toBe(500);
  });
  it("serves bundle bytes", async () => {
    const r = await app.request("/b/tide/r3.hbc", {}, { POINTERS: kv({ "b/tide/r3.hbc": "xyz" }) } as any);
    expect(r.status).toBe(200); expect(await r.text()).toBe("xyz");
  });
  it("rejects bad telemetry", async () =>
    expect((await app.request("/t", { method: "POST", body: JSON.stringify({ app_id: "tide" }) }, {} as any)).status).toBe(400));
});
