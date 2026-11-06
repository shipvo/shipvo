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
  it("answers 404 release_halted for a halted release only", async () => {
    const halt = (release: number) => JSON.stringify({ release, halted_at: "2026-11-05T00:00:00Z" });
    const r = await app.request("/p/tide/1/b0.json", { headers: { "if-none-match": '"3"' } }, { POINTERS: kv({ "p/tide/1/b0": envl, "halt/tide": halt(3) }) } as any);
    expect(r.status).toBe(404); expect(await r.json()).toEqual({ error: "release_halted", release: 3 });
    expect(r.headers.get("cache-control")).toBe("public, max-age=5");
    expect((await app.request("/p/tide/1/b0.json", {}, { POINTERS: kv({ "p/tide/1/b0": envl, "halt/tide": halt(2) }) } as any)).status).toBe(200);
    expect((await app.request("/p/tide/1/b0.json", {}, { POINTERS: kv({ "p/tide/1/b0": envl, "halt/tide": "{nope" }) } as any)).status).toBe(200);
    expect((await app.request("/p/tide/1/b0.json", {}, { POINTERS: kv({ "p/tide/1/b0": envl, "halt/other": halt(3) }) } as any)).status).toBe(200);
  });
  it("filters releases by the shell's Hermes bytecode versions", async () => {
    const withV = JSON.stringify({ body: JSON.stringify({ ...body, hermes_bytecode_version: 96 }), signature: "AAAA" });
    const env = { POINTERS: kv({ "p/tide/1/b0": withV }) } as any;
    const mismatch = await app.request("/p/tide/1/b0.json?hbc=98", {}, env);
    expect(mismatch.status).toBe(404); expect((await mismatch.json() as any).error).toBe("hermes_bytecode_mismatch");
    expect((await app.request("/p/tide/1/b0.json?hbc=96", {}, env)).status).toBe(200);
    expect((await app.request("/p/tide/1/b0.json?hbc=94,96", {}, env)).status).toBe(200);
    expect((await app.request("/p/tide/1/b0.json", {}, env)).status).toBe(200);
    expect((await app.request("/p/tide/1/b0.json?hbc=x", {}, env)).status).toBe(400);
    // release without the field is offered to any shell
    expect((await app.request("/p/tide/1/b0.json?hbc=98", {}, { POINTERS: kv({ "p/tide/1/b0": envl }) } as any)).status).toBe(200);
  });
  it("refuses a release built by another Hermes engine build", async () => {
    const withE = JSON.stringify({ body: JSON.stringify({ ...body, hermes_bytecode_version: 96, hermes_engine: "250829098.0.10" }), signature: "AAAA" });
    const env = { POINTERS: kv({ "p/tide/1/b0": withE }) } as any;
    const r = await app.request("/p/tide/1/b0.json?hbc=96&hbe=250829098.0.16", {}, env);
    expect(r.status).toBe(404); expect((await r.json() as any).error).toBe("hermes_bytecode_mismatch");
    for (const q of ["hbc=96&hbe=250829098.0.10", "hbc=96", "hbe=bad"]) expect((await app.request(`/p/tide/1/b0.json?${q}`, {}, env)).status).toBe(200);
    expect((await app.request("/p/tide/1/b0.json?hbe=250829098.0.16", {}, { POINTERS: kv({ "p/tide/1/b0": envl }) } as any)).status).toBe(200);
  });
  it("filters releases by the shell's native modules", async () => {
    const withN = JSON.stringify({ body: JSON.stringify({ ...body, required_native_modules: { "@scope/maps": "^2.0.0" } }), signature: "AAAA" });
    const env = { POINTERS: kv({ "p/tide/1/b0": withN }) } as any;
    const missing = await app.request("/p/tide/1/b0.json?nm=other@1.0.0", {}, env);
    expect(missing.status).toBe(404); expect(await missing.json()).toMatchObject({ error: "native_module_missing", module: "@scope/maps" });
    const old = await app.request("/p/tide/1/b0.json?nm=@scope/maps@1.9.0", {}, env);
    expect(old.status).toBe(404); expect(await old.json()).toMatchObject({ error: "native_module_version", have: "1.9.0", required: "^2.0.0" });
    expect((await app.request("/p/tide/1/b0.json?nm=@scope/maps@2.3.0,other@1.0.0", {}, env)).status).toBe(200);
    expect((await app.request("/p/tide/1/b0.json", {}, env)).status).toBe(200); // shell side unknown
    expect((await app.request("/p/tide/1/b0.json?nm=other@1.0.0", {}, { POINTERS: kv({ "p/tide/1/b0": envl }) } as any)).status).toBe(200); // release side unknown
    const pre = await app.request("/p/tide/1/b0.json?nm=@scope/maps@2.0.0-rc.1", {}, env);
    expect(pre.status).toBe(200);
    expect((await app.request("/p/tide/1/b0.json?nm=junk", {}, env)).status).toBe(400);
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
