import { describe, it, expect } from "vitest";
import app from "../src/index";

const kv = (m: Record<string, string>) => ({ get: async (k: string) => m[k] ?? null }) as any;
const h = "a".repeat(64);
const ptr = { schema_version: "1.0", app_id: "tide", shell_major: 1, band: "b0", release: 3, issued_at: "2026-10-30T00:00:00Z",
  core: { version: "1.0.0", sha256: h, size: 10, url: "c" }, min_shell_version: "1.0.0", signature: "AAAA".repeat(16) };

describe("control plane", () => {
  it("health", async () => expect((await app.request("/health", {}, { POINTERS: kv({}) } as any)).status).toBe(200));
  it("serves pointer with etag and 304", async () => {
    const env = { POINTERS: kv({ "p/tide/1/b0": JSON.stringify(ptr) }) } as any;
    const r = await app.request("/p/tide/1/b0.json", {}, env);
    expect(r.status).toBe(200); expect(r.headers.get("etag")).toBe('"3"');
    expect((await app.request("/p/tide/1/b0.json", { headers: { "if-none-match": '"3"' } }, env)).status).toBe(304);
  });
  it("404 when no release, 400 on bad band", async () => {
    const env = { POINTERS: kv({}) } as any;
    expect((await app.request("/p/tide/1/b0.json", {}, env)).status).toBe(404);
    expect((await app.request("/p/tide/1/zz.json", {}, env)).status).toBe(400);
  });
  it("band helper", async () => expect(await (await app.request("/band/5", {}, {} as any)).json()).toEqual({ band: "b0" }));
});
