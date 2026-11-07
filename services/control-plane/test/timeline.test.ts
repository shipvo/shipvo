import { describe, it, expect } from "vitest";
import app from "../src/index";

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function setup() {
  const store: Record<string, string> = {};
  const POINTERS = {
    get: async (k: string) => store[k] ?? null, put: async (k: string, v: string) => { store[k] = v; },
    list: async ({ prefix }: { prefix: string }) => ({ keys: Object.keys(store).filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  } as any;
  const good = await sha("sv_publish_good");
  const DB = { prepare: (sql: string) => ({ bind: (...a: unknown[]) => ({
    run: async () => ({}),
    first: async () => sql.includes("FROM publish_tokens") ? (a[0] === good && a[1] === "tide" ? { id: 1, expires_at: null } : null) : sql.includes("FROM apps") ? { public_key: "k", bytes_used: 0 } : null,
    all: async () => ({ results: [] }),
  }) }) } as any;
  return { POINTERS, DB, ADMIN_PASSWORD: "pw", OWNER_TOKEN: "owner-secret" } as any;
}
const H = { authorization: "Bearer sv_publish_good", "content-type": "application/json" };
const img = (n: string) => `data:image/png;base64,${btoa(n)}`;
const up = (env: any, path: string, body: unknown) => app.request(path, { method: "POST", headers: H, body: JSON.stringify(body) }, env);
const flows = (o: Record<string, "passed" | "failed">) => Object.entries(o).map(([name, status]) => ({ name, status }));

async function cookie(env: any) {
  const r = await app.request("/app/tide/admin/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "password=pw" }, env);
  return r.headers.get("set-cookie")!.split(";")[0]!;
}

describe("behaviour timeline", () => {
  it("stores findings, screens and PR runs, and compares two releases per skin", async () => {
    const env = await setup();
    expect((await up(env, "/r/tide/1/tests", { flows: flows({ checkout: "passed", login: "passed" }), findings: [{ title: "Overflow on cart" }], screens: [{ name: "cart", thumb: img("a") }] })).status).toBe(200);
    await up(env, "/r/tide/1/tests", { platform: "ios", flows: flows({ checkout: "passed" }), screens: [{ name: "cart", thumb: img("ios1") }] });
    await up(env, "/r/tide/2/tests", { flows: flows({ checkout: "failed", login: "passed" }), screens: [{ name: "cart", thumb: img("b") }, { name: "home", thumb: img("h") }] });
    await up(env, "/r/tide/2/tests", { platform: "ios", flows: flows({ checkout: "passed" }), screens: [{ name: "cart", thumb: img("ios1") }] });
    expect((await up(env, "/r/tide/pr/7/tests", { flows: flows({ checkout: "passed" }) })).status).toBe(200);
    const ck = await cookie(env);
    const t: any = await (await app.request("/app/tide/timeline.json", { headers: { cookie: ck } }, env)).json();
    expect(t.points.map((p: any) => p.id).sort()).toEqual(["p7", "r1", "r2"]);
    const r1 = t.points.find((p: any) => p.id === "r1");
    expect(r1.findings).toEqual([{ title: "Overflow on cart", severity: null, platforms: ["android"] }]);
    expect(r1.screens).toHaveLength(2);
    const d: any = await (await app.request("/app/tide/timeline/compare?from=r1&to=r2", { headers: { cookie: ck } }, env)).json();
    expect(d.flows).toEqual([{ name: "checkout", before: "passed", after: "failed" }]);
    expect(d.findings).toEqual({ added: [], removed: ["Overflow on cart"] });
    expect(d.screens).toEqual([
      { name: "cart", platform: "android", before: img("a"), after: img("b") },
      { name: "home", platform: "android", before: null, after: img("h") },
    ]); // the iOS cart screen is identical, so it is not listed
  });
  it("rejects bad findings and thumbnails", async () => {
    const env = await setup();
    expect((await up(env, "/r/tide/1/tests", { flows: [], screens: [{ name: "x", thumb: "http://evil/x.png" }] })).status).toBe(400);
    expect((await up(env, "/r/tide/1/tests", { flows: [], findings: [{ title: "" }] })).status).toBe(400);
  });
  it("is for the owner session only: no cookie, publish token and owner token are refused", async () => {
    const env = await setup();
    await up(env, "/r/tide/1/tests", { flows: flows({ a: "passed" }) });
    for (const path of ["/app/tide/timeline.json", "/app/tide/timeline/compare?from=r1&to=r1"]) {
      expect((await app.request(path, {}, env)).status).toBe(401);
      expect((await app.request(path, { headers: H }, env)).status).toBe(401);
      expect((await app.request(path, { headers: { authorization: "Bearer owner-secret" } }, env)).status).toBe(401);
    }
    const ck = await cookie(env);
    expect((await app.request("/app/tide/timeline/compare?from=r1&to=r9", { headers: { cookie: ck } }, env)).status).toBe(404);
    expect((await app.request("/app/tide/timeline/compare?from=x&to=r1", { headers: { cookie: ck } }, env)).status).toBe(400);
  });
});

describe("behaviour timeline: pull requests and report size", () => {
  const big = (c: string) => `data:image/png;base64,${c.repeat(7900)}`;
  it("accepts a report with the maximum number of full-size screens", async () => {
    const env = await setup();
    const screens = Array.from({ length: 20 }, (_, i) => ({ name: `s${i}`, thumb: big("A") }));
    expect((await up(env, "/r/tide/1/tests", { flows: flows({ a: "passed" }), screens })).status).toBe(200);
    expect((await up(env, "/r/tide/pr/3/tests", { flows: flows({ a: "passed" }), screens })).status).toBe(200);
    const over = await up(env, "/r/tide/1/tests", { flows: [], screens: Array.from({ length: 21 }, (_, i) => ({ name: `s${i}`, thumb: img("a") })) });
    expect(over.status).toBe(400);
  });
  it("names screens in the too-large message", async () => {
    const env = await setup();
    env.MAX_TEST_REPORT_BYTES = "100";
    const r = await up(env, "/r/tide/1/tests", { flows: flows({ a: "passed" }), screens: [{ name: "x", thumb: img("a") }] });
    expect(r.status).toBe(413);
    expect(((await r.json()) as any).message).toContain("screens");
  });
  it("compares a pull request with a release", async () => {
    const env = await setup();
    await up(env, "/r/tide/3/tests", { flows: flows({ checkout: "passed", login: "passed" }), findings: [{ title: "Old bug" }], screens: [{ name: "cart", thumb: img("a") }] });
    await up(env, "/r/tide/pr/7/tests", { flows: flows({ checkout: "failed", login: "passed" }), findings: [{ title: "New bug" }], screens: [{ name: "cart", thumb: img("b") }, { name: "home", thumb: img("h") }] });
    const ck = await cookie(env);
    const d: any = await (await app.request("/app/tide/timeline/compare?from=r3&to=p7", { headers: { cookie: ck } }, env)).json();
    expect(d.flows).toEqual([{ name: "checkout", before: "passed", after: "failed" }]);
    expect(d.findings).toEqual({ added: ["New bug"], removed: ["Old bug"] });
    expect(d.screens).toEqual([
      { name: "cart", platform: "android", before: img("a"), after: img("b") },
      { name: "home", platform: "android", before: null, after: img("h") },
    ]);
    expect((await app.request("/app/tide/timeline/compare?from=r3&to=p99", { headers: { cookie: ck } }, env)).status).toBe(404);
  });
  it("rejects a bad PR number and an unauthenticated PR report", async () => {
    const env = await setup();
    expect((await up(env, "/r/tide/pr/abc/tests", { flows: [] })).status).toBe(400);
    expect((await up(env, "/r/tide/pr/1234567890/tests", { flows: [] })).status).toBe(400);
    expect((await app.request("/r/tide/pr/7/tests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ flows: [] }) }, env)).status).toBe(401);
    expect((await app.request("/r/tide/pr/7/tests", { method: "POST", headers: { authorization: "Bearer sv_publish_bad", "content-type": "application/json" }, body: JSON.stringify({ flows: [] }) }, env)).status).toBe(401);
  });
});
