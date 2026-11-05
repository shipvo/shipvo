import { describe, it, expect } from "vitest";
import app from "../src/index";

const kv = (m: Record<string, string>) => ({
  get: async (k: string, t?: string) => (k in m ? (t === "arrayBuffer" ? new TextEncoder().encode(m[k]).buffer : m[k]) : null),
  getWithMetadata: async (k: string, t?: string) => ({ value: k in m ? (t === "arrayBuffer" ? new TextEncoder().encode(m[k]).buffer : m[k]) : null, metadata: null }),
}) as any;

function db() {
  const calls: { sql: string; args: unknown[] }[] = [];
  const d = { prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ run: async () => { calls.push({ sql, args }); return {}; }, all: async () => ({ results: [{ id: 1 }] }) }) }) } as any;
  return { d, calls };
}
const post = (path: string, body: unknown, env: any) => app.request(path, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }, env);

describe("GET /band/:cohort", () => {
  it("maps cohorts to bands", async () => {
    const band = async (n: string) => (await (await app.request(`/band/${n}`, {}, {} as any)).json() as any).band;
    expect(await band("0")).toBe("b0"); expect(await band("9")).toBe("b0");
    expect(await band("10")).toBe("b1"); expect(await band("99")).toBe("b1");
    expect(await band("100")).toBe("b2"); expect(await band("999")).toBe("b2");
  });
  it("rejects out-of-range and non-integer cohorts", async () => {
    for (const n of ["1000", "-1", "abc", "1.5"]) expect((await app.request(`/band/${n}`, {}, {} as any)).status).toBe(400);
  });
});

describe("POST /t telemetry", () => {
  const ev = { schema_version: "1.0", app_id: "tide", release: 3, event: "applied" };
  it("stores a valid event and trims extras", async () => {
    const { d, calls } = db();
    const r = await post("/t", { ...ev, device_model: "x".repeat(200), published_at: "p".repeat(100), android_api: 34, via: "patch" }, { DB: d } as any);
    expect(r.status).toBe(202);
    const a = calls[0].args;
    expect(a.slice(0, 3)).toEqual(["tide", 3, "applied"]);
    expect((a[7] as string).length).toBe(40); expect((a[8] as string).length).toBe(80);
    expect(a[9]).toBe(34); expect(a[10]).toBe("patch");
  });
  it("stores verify_failed and download_failed with the release id", async () => {
    for (const event of ["verify_failed", "download_failed"]) {
      const { d, calls } = db();
      expect((await post("/t", { ...ev, release: 9, event }, { DB: d } as any)).status).toBe(202);
      expect(calls[0].args.slice(0, 3)).toEqual(["tide", 9, event]);
    }
  });
  it("accepts refusal events and still accepts older ones", async () => {
    for (const event of ["hermes_bytecode_mismatch", "native_module_missing", "native_module_version", "applied"]) {
      const { d, calls } = db();
      expect((await post("/t", { ...ev, release: 4, event }, { DB: d } as any)).status).toBe(202);
      expect(calls[0].args.slice(0, 3)).toEqual(["tide", 4, event]);
    }
  });
  it("drops unknown 'via' and non-integer android_api", async () => {
    const { d, calls } = db();
    await post("/t", { ...ev, via: "zip", android_api: 34.5 }, { DB: d } as any);
    expect(calls[0].args[9]).toBeNull(); expect(calls[0].args[10]).toBeNull();
  });
  it("rejects bad JSON, unknown events and bad app ids", async () => {
    const { d, calls } = db();
    expect(((await post("/t", "{nope", { DB: d } as any)).status)).toBe(400);
    expect((await post("/t", { ...ev, event: "exploded" }, { DB: d } as any)).status).toBe(400);
    expect((await post("/t", { ...ev, app_id: "../x" }, { DB: d } as any)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /o/:app orders", () => {
  const order = { id: "TT-1", lines: [], total: 12.6 };
  it("stores a valid order with a rounded total", async () => {
    const { d, calls } = db();
    expect((await post("/o/tide", { order }, { DB: d } as any)).status).toBe(202);
    expect(calls[0].args.slice(0, 3)).toEqual(["tide", "TT-1", 13]);
  });
  it("rejects malformed orders and oversized bodies", async () => {
    const { d, calls } = db();
    expect((await post("/o/tide", { order: { ...order, total: "5" } }, { DB: d } as any)).status).toBe(400);
    expect((await post("/o/tide", { order: { ...order, lines: "x" } }, { DB: d } as any)).status).toBe(400);
    expect((await post("/o/tide", "nope", { DB: d } as any)).status).toBe(400);
    expect((await post("/o/Bad!", { order }, { DB: d } as any)).status).toBe(400);
    expect((await post("/o/tide", { order: { ...order, note: "x".repeat(21_000) } }, { DB: d } as any)).status).toBe(413);
    expect(calls).toHaveLength(0);
  });
});

describe("GET /c/:app/content.json", () => {
  const env = { POINTERS: kv({ "c/tide/content.json": '{"version":4,"x":1}' }) } as any;
  it("serves content with an etag and honours If-None-Match", async () => {
    const r = await app.request("/c/tide/content.json", {}, env);
    expect(r.status).toBe(200); expect(r.headers.get("etag")).toBe('"4"');
    expect((await app.request("/c/tide/content.json", { headers: { "if-none-match": '"4"' } }, env)).status).toBe(304);
    expect((await app.request("/c/tide/content.json", { headers: { "if-none-match": '"3"' } }, env)).status).toBe(200);
  });
  it("404s when there is no content and 400s on a bad id", async () => {
    expect((await app.request("/c/other/content.json", {}, env)).status).toBe(404);
    expect((await app.request("/c/Bad!/content.json", {}, env)).status).toBe(400);
  });
});

describe("web artifacts and bundles", () => {
  const env = { POINTERS: kv({ "w/tide/r3/index.html": "<p>hi</p>", "w/tide/r3/a/app.js": "1", "w/tide/releases": "[]", "w/tide/store/icon.png": "png", "b/tide/r3.hbc": "x" }) } as any;
  it("serves html, nested files and the release list with the right types", async () => {
    const html = await app.request("/w/tide/r3/index.html", {}, env);
    expect(html.headers.get("content-type")).toContain("text/html"); expect(html.headers.get("cache-control")).toBe("public, max-age=60");
    const js = await app.request("/w/tide/r3/a/app.js", {}, env);
    expect(js.headers.get("content-type")).toBe("text/javascript"); expect(js.headers.get("cache-control")).toContain("immutable");
    expect((await app.request("/w/tide/releases.json", {}, env)).status).toBe(200);
    expect((await app.request("/w/tide/store/icon.png", {}, env)).headers.get("content-type")).toBe("image/png");
  });
  it("rejects bad release names, path traversal and missing files", async () => {
    expect((await app.request("/w/tide/latest/index.html", {}, env)).status).toBe(400);
    expect((await app.request("/w/tide/r3/..%2Fsecret", {}, env)).status).toBe(400);
    expect((await app.request("/w/tide/r9/index.html", {}, env)).status).toBe(404);
    expect((await app.request("/w/tide/store/nope.png", {}, env)).status).toBe(404);
  });
  it("rejects bundle names with odd characters", async () => {
    expect((await app.request("/b/tide/r3.hbc", {}, env)).status).toBe(200);
    expect((await app.request("/b/tide/a%20b", {}, env)).status).toBe(400);
    expect((await app.request("/b/tide/missing.hbc", {}, env)).status).toBe(404);
  });

  it("serves the tail of a bundle for a Range request", async () => {
    const e = { POINTERS: kv({ "b/tide/r3.hbc": "0123456789" }) } as any;
    const r = await app.request("/b/tide/r3.hbc", { headers: { range: "bytes=4-" } }, e);
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 4-9/10");
    expect(await r.text()).toBe("456789");
    expect((await app.request("/b/tide/r3.hbc", { headers: { range: "bytes=10-" } }, e)).status).toBe(416);
    const full = await app.request("/b/tide/r3.hbc", {}, e);
    expect(full.status).toBe(200);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
  });
});

describe("owner auth", () => {
  const env = { OWNER_TOKEN: "tok-123", ADMIN_PASSWORD: "pw", POINTERS: kv({}), DB: db().d } as any;
  const cmd = (headers: Record<string, string>, path = "/app/tide/api/command") =>
    app.request(path, { method: "POST", headers, body: JSON.stringify({ name: "nope" }) }, env);
  it("refuses calls with no credentials or a wrong token", async () => {
    expect((await cmd({})).status).toBe(401);
    expect((await cmd({ authorization: "Bearer tok-124" })).status).toBe(401);
    expect((await cmd({ authorization: "Bearer tok" })).status).toBe(401);
    expect((await app.request("/app/tide/api/describe", {}, env)).status).toBe(401);
  });
  it("accepts the owner token", async () => {
    expect((await app.request("/app/tide/api/describe", { headers: { authorization: "Bearer tok-123" } }, env)).status).toBe(200);
  });
  it("does not accept a token when none is configured", async () => {
    const r = await app.request("/app/tide/api/describe", { headers: { authorization: "Bearer " } }, { ...env, OWNER_TOKEN: undefined });
    expect(r.status).toBe(401);
  });
  it("login sets a cookie that works only for its own app", async () => {
    const bad = await app.request("/app/tide/admin/login", { method: "POST", body: new URLSearchParams({ password: "no" }) }, env);
    expect(bad.status).toBe(401);
    const ok = await app.request("/app/tide/admin/login", { method: "POST", body: new URLSearchParams({ password: "pw" }) }, env);
    expect(ok.status).toBe(303);
    const cookie = ok.headers.get("set-cookie")!.split(";")[0];
    expect((await app.request("/app/tide/api/describe", { headers: { cookie } }, env)).status).toBe(200);
    expect((await app.request("/app/other/api/describe", { headers: { cookie } }, env)).status).toBe(401);
    const [a, exp] = cookie.split("=")[1].split(".");
    const forged = `pn_admin=${a}.${Number(exp) + 1}.${cookie.split(".")[2]}`;
    expect((await app.request("/app/tide/api/describe", { headers: { cookie: forged } }, env)).status).toBe(401);
  });
  it("login is refused when no admin password is configured", async () => {
    const r = await app.request("/app/tide/admin/login", { method: "POST", body: new URLSearchParams({ password: "" }) }, { ...env, ADMIN_PASSWORD: undefined });
    expect(r.status).toBe(401);
  });
});

describe("GET /t/:app/summary", () => {
  const fake = (counts: any[], apply: any[], cold: any[]) => ({
    prepare: (sql: string) => ({ bind: () => ({ all: async () => ({
      results: sql.includes("COUNT(*) AS n") ? counts : sql.includes("apply_ms IS NOT NULL") ? apply : cold,
    }) }) }),
  }) as any;
  it("groups counts and medians per release, newest first", async () => {
    const d = fake(
      [{ release: 2, event: "applied", n: 3, last_id: 5 }, { release: 2, event: "reverted", n: 1, last_id: 9 }, { release: 1, event: "applied", n: 2, last_id: 4 }],
      [{ release: 2, m: 120 }], [{ release: 2, m: 800 }, { release: 1, m: 900 }]);
    const r = await app.request("/t/tide/summary", {}, { DB: d } as any);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ halted: null, releases: [
      { release: 2, events: { applied: 3, reverted: 1 }, apply_ms_median: 120, cold_start_ms_median: 800 },
      { release: 1, events: { applied: 2 }, apply_ms_median: null, cold_start_ms_median: 900 },
    ] });
  });
  it("counts refusal events per release", async () => {
    const d = fake([{ release: 3, event: "hermes_bytecode_mismatch", n: 2, last_id: 8 }, { release: 3, event: "native_module_missing", n: 1, last_id: 9 }, { release: 3, event: "native_module_version", n: 4, last_id: 7 }], [], []);
    const r = await app.request("/t/tide/summary", {}, { DB: d } as any);
    expect((await r.json() as any).releases[0].events).toEqual({ hermes_bytecode_mismatch: 2, native_module_missing: 1, native_module_version: 4 });
  });
  it("returns an empty list for an app with no rows", async () => {
    const r = await app.request("/t/tide/summary", {}, { DB: fake([], [], []) } as any);
    expect(await r.json()).toEqual({ releases: [], halted: null });
  });
  it("returns the halt object when halt/<app> exists, null when corrupt", async () => {
    const halt = { release: 4, halted_at: "2026-11-05T00:00:00.000Z", reports: 40, failed: 12, threshold: 0.2 };
    const kv = (v: string | null) => ({ get: async (k: string) => (k === "halt/tide" ? v : null) });
    const r = await app.request("/t/tide/summary", {}, { DB: fake([], [], []), POINTERS: kv(JSON.stringify(halt)) } as any);
    expect((await r.json() as any).halted).toEqual(halt);
    const bad = await app.request("/t/tide/summary", {}, { DB: fake([], [], []), POINTERS: kv("{nope") } as any);
    expect((await bad.json() as any).halted).toBeNull();
    const none = await app.request("/t/tide/summary", {}, { DB: fake([], [], []), POINTERS: kv(null) } as any);
    expect((await none.json() as any).halted).toBeNull();
  });
  it("rejects a bad app id", async () => {
    const r = await app.request("/t/Bad!/summary", {}, { DB: fake([], [], []) } as any);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "bad_request" });
  });
});
