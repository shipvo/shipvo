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
