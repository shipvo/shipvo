import { describe, it, expect } from "vitest";
import app from "../src/index";

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function setup(extra: Record<string, string> = {}) {
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
  return { env: { POINTERS, DB, ...extra } as any, store };
}
const H = { authorization: "Bearer sv_publish_good", "content-type": "application/json" };
const post = (env: any, rel: number | string, body: unknown, headers: Record<string, string> = H, appId = "tide") =>
  app.request(`/r/${appId}/${rel}/tests`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }, env);
const flows = (o: Record<string, "passed" | "failed">) => Object.entries(o).map(([name, status]) => ({ name, status, steps: [{ kind: "tap", text: "secret-value" }], message: "token=abc" }));

describe("test results by release", () => {
  it("round trip, and first failed release across three releases", async () => {
    const s = await setup();
    expect((await post(s.env, 1, { flows: flows({ checkout: "passed", login: "passed" }) })).status).toBe(200);
    expect((await post(s.env, 2, { flows: flows({ checkout: "failed", login: "passed" }) })).status).toBe(200);
    expect((await post(s.env, 3, { flows: flows({ checkout: "failed", login: "failed" }) })).status).toBe(200);
    const g = await app.request("/r/tide/tests", { headers: H }, s.env);
    const d: any = await g.json();
    expect(d.releases.map((r: any) => r.release)).toEqual([3, 2, 1]);
    expect(d.releases[0].failing_flows).toEqual([
      { name: "checkout", platforms: ["android"], first_failed_release: 2 },
      { name: "login", platforms: ["android"], first_failed_release: 3 },
    ]);
    expect(d.releases[1].failing_flows).toEqual([{ name: "checkout", platforms: ["android"], first_failed_release: 2 }]);
    expect(d.releases[2]).toMatchObject({ failing: 0, passing: 2 });
  });
  it("a flow that passes again starts a new run of failures; platforms merge", async () => {
    const s = await setup();
    await post(s.env, 1, { flows: flows({ a: "failed" }) });
    await post(s.env, 2, { flows: flows({ a: "passed" }) });
    await post(s.env, 3, { platform: "ios", flows: flows({ a: "failed" }) });
    await post(s.env, 3, { platform: "android", flows: flows({ a: "passed" }) });
    const d: any = await (await app.request("/r/tide/tests", { headers: H }, s.env)).json();
    expect(d.releases[0].failing_flows).toEqual([{ name: "a", platforms: ["ios"], first_failed_release: 3 }]);
  });
  it("rejects missing auth, wrong app and bad tokens", async () => {
    const s = await setup();
    expect((await post(s.env, 1, { flows: [] }, { "content-type": "application/json" })).status).toBe(401);
    expect((await post(s.env, 1, { flows: [] }, { authorization: "Bearer sv_publish_bad" })).status).toBe(401);
    expect((await post(s.env, 1, { flows: [] }, H, "other")).status).toBe(401);
    expect((await app.request("/r/tide/tests", {}, s.env)).status).toBe(401);
    expect((await post(s.env, 1, { app: "other", flows: [] })).status).toBe(400);
    expect(Object.keys(s.store)).toEqual([]);
  });
  it("gives a plain 4xx for oversized or malformed reports", async () => {
    const s = await setup({ MAX_TEST_REPORT_BYTES: "200" });
    const big = await post(s.env, 1, { flows: flows({ a: "passed", b: "passed", c: "passed" }) });
    expect(big.status).toBe(413);
    expect(((await big.json()) as any).message).toMatch(/larger than 200 bytes/);
    expect((await post(s.env, 1, "{nope")).status).toBe(400);
    expect((await post(s.env, 1, { flows: "x" })).status).toBe(400);
    expect((await post(s.env, 1, { flows: [{ name: "a", status: "maybe" }] })).status).toBe(400);
    expect((await post(s.env, 1, { platform: "web", flows: [] })).status).toBe(400);
    expect((await post(s.env, "x", { flows: [] })).status).toBe(400);
    expect(Object.keys(s.store)).toEqual([]);
  });
  it("stores the allowed fields only", async () => {
    const s = await setup();
    await post(s.env, 4, { app: "tide", release: 4, platform: "ios", commit: "abcdef1234567", time: "2026-11-01T10:00:00Z", token: "sv_publish_x", flows: flows({ a: "failed" }), parityLimits: { x: 1 } });
    const v = JSON.parse(s.store["tr/tide/4/ios"]);
    expect(Object.keys(v).sort()).toEqual(["app", "commit", "flows", "platform", "release", "time", "uploaded_at"]);
    expect(v.flows).toEqual([{ name: "a", status: "failed" }]);
    expect(JSON.stringify(v)).not.toMatch(/secret-value|token=|sv_publish/);
  });
});
