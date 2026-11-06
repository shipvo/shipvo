import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import app from "../src/index";
import { hmacHex } from "../src/installs";
import { TELEMETRY_LIMITS as T, REGISTER_LIMITS as R } from "../src/ratelimit";

function env() {
  const m: Record<string, string> = {};
  const kv = { get: async (k: string) => m[k] ?? null, put: async (k: string, v: string) => { m[k] = v; } } as any;
  const run = async () => ({});
  const DB = { prepare: () => ({ bind: () => ({ run, all: async () => ({ results: [] }), first: async () => null }) }) } as any;
  return { m, e: { POINTERS: kv, DB, TELEMETRY_SECRET: "s" } as any };
}
const ev = (extra: object = {}) => ({ schema_version: "1.0", app_id: "tide", release: 1, event: "applied", ...extra });
const post = (e: any, body: unknown, ip: string) => app.request("/t", { method: "POST", body: JSON.stringify(body), headers: { "cf-connecting-ip": ip } }, e);
const reg = (e: any, body: unknown, ip: string) => app.request("/t/register", { method: "POST", body: JSON.stringify(body), headers: { "cf-connecting-ip": ip } }, e);

// Windows are fixed 60s buckets of wall-clock time. Pin the clock early in a bucket so filling a
// budget cannot straddle a bucket boundary and reset the count.
const pinClock = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Math.floor(Date.now() / 60_000) * 60_000 + 1_000); };

describe("POST /t rate limits", () => {
  beforeEach(pinClock);
  afterEach(() => vi.useRealTimers());
  it("passes requests under the limits, including old runtimes with no install id", async () => {
    const { e } = env();
    for (let i = 0; i < 20; i++) expect((await post(e, ev(), "1.1.1.1")).status).toBe(202);
    expect((await post(e, ev({ install_id: "install-aaaa" }), "1.1.1.1")).status).toBe(202);
  });
  it("429s with Retry-After per IP", async () => {
    const { e } = env();
    for (let i = 0; i < T.perIp; i++) await post(e, ev(), "2.2.2.2");
    const r = await post(e, ev(), "2.2.2.2");
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await post(e, ev(), "3.3.3.3")).status).toBe(202);
  });
  it("429s per install id, from any IP", async () => {
    const { e } = env();
    for (let i = 0; i < T.perInstall; i++) await post(e, ev({ install_id: "install-bbbb" }), `10.0.${i}.1`);
    const r = await post(e, ev({ install_id: "install-bbbb" }), "10.9.9.9");
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    expect((await post(e, ev({ install_id: "install-cccc" }), "10.9.9.9")).status).toBe(202);
  });
  it("429s per app, from any IP and install", async () => {
    const { e } = env();
    for (let i = 0; i < T.perApp; i++) await post(e, ev({ install_id: `install-${i}-xx` }), `10.${i >> 8}.${i & 255}.1`);
    const r = await post(e, ev({ install_id: "install-fresh01" }), "9.9.9.9");
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    expect((await post(e, ev({ app_id: "other" }), "9.9.9.9")).status).toBe(202);
  });
  it("stores only hashed IPs", async () => {
    const { e, m } = env();
    await post(e, ev(), "4.4.4.4");
    expect(Object.keys(m).some((k) => k.includes("4.4.4.4"))).toBe(false);
  });
});

describe("POST /t caps count unverified reports only", () => {
  beforeEach(pinClock);
  afterEach(() => vi.useRealTimers());
  const KEY = "key-hash-for-test";
  const signedEnv = () => {
    const x = env();
    const inserts: unknown[][] = [];
    x.e.DB = { prepare: (q: string) => ({ bind: (...a: unknown[]) => ({
      run: async () => { if (q.startsWith("INSERT INTO telemetry")) inserts.push(a); return {}; },
      all: async () => ({ results: [] }),
      first: async () => (q.includes("FROM installs") ? { key_hash: KEY } : null),
    }) }) };
    return { ...x, inserts };
  };
  const postSigned = async (e: any, extra: object, ip: string) => {
    const raw = JSON.stringify(ev(extra));
    return app.request("/t", { method: "POST", body: raw, headers: { "cf-connecting-ip": ip, "x-shipvo-sig": await hmacHex(KEY, raw) } }, e);
  };
  it("accepts a signed report after the per-app unverified budget is full", async () => {
    const { e, inserts } = signedEnv();
    for (let i = 0; i < T.perApp; i++) await post(e, ev({ install_id: `install-${i}-xx` }), `10.${i >> 8}.${i & 255}.1`);
    expect((await post(e, ev({ install_id: "install-fresh01" }), "9.9.9.9")).status).toBe(429);
    const before = inserts.length;
    const r = await postSigned(e, { install_id: "install-real001", event: "crash_loop_revert" }, "9.9.9.8");
    expect(r.status).toBe(202);
    expect(inserts.length).toBe(before + 1);
    expect(inserts[inserts.length - 1]).toContain(1); // stored as verified, so it reaches maybeHalt
  });
  it("accepts a signed report for an install whose id was spoofed past the install cap", async () => {
    const { e } = signedEnv();
    for (let i = 0; i < T.perInstall; i++) await post(e, ev({ install_id: "install-victim" }), `10.0.${i}.1`);
    expect((await post(e, ev({ install_id: "install-victim" }), "10.9.9.9")).status).toBe(429);
    expect((await postSigned(e, { install_id: "install-victim" }, "10.9.9.8")).status).toBe(202);
  });
});

describe("POST /t/register rate limits", () => {
  const body = (i: number | string, app_id = "tide") => ({ app_id, install_id: `install-${i}-reg`, shell_version: "1.0.0" });
  it("429s per IP, per install and per app; passes under the limit", async () => {
    const a = env();
    expect((await reg(a.e, body(1), "5.5.5.5")).status).toBe(201);
    for (let i = 0; i < R.perIp; i++) await reg(a.e, body(i), "6.6.6.6");
    const ipRes = await reg(a.e, body(99), "6.6.6.6");
    expect(ipRes.status).toBe(429);
    expect(ipRes.headers.get("retry-after")).toBeTruthy();

    const b = env();
    for (let i = 0; i < R.perInstall; i++) await reg(b.e, body("same"), `7.0.${i}.1`);
    expect((await reg(b.e, body("same"), "7.9.9.9")).status).toBe(429);

    const c = env();
    for (let i = 0; i < R.perApp; i++) await reg(c.e, body(i), `8.${i >> 8}.${i & 255}.1`);
    const appRes = await reg(c.e, body("late"), "8.99.99.99");
    expect(appRes.status).toBe(429);
    expect(appRes.headers.get("retry-after")).toBeTruthy();
  });
});

describe("rate limit edge cases", () => {
  afterEach(() => vi.useRealTimers());
  it("Retry-After is the seconds left in the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000 + 17_000));
    const { e } = env();
    const win = T.windowSeconds * 1000, now = Date.now();
    const left = Math.ceil((Math.floor(now / win) * win + win - now) / 1000);
    for (let i = 0; i < T.perIp; i++) await post(e, ev(), "2.2.2.2");
    const r = await post(e, ev(), "2.2.2.2");
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBe(left);
    expect(left).toBeLessThanOrEqual(T.windowSeconds);
    vi.setSystemTime(Math.floor(now / win) * win + win - 3_000); // 3s left
    for (let i = 0; i < T.perIp; i++) await post(e, ev(), "2.2.2.3");
    expect(Number((await post(e, ev(), "2.2.2.3")).headers.get("retry-after"))).toBe(3);
  });
  it("fails open when KV throws", async () => {
    const { e } = env();
    const stored: unknown[] = [];
    e.POINTERS = { get: async () => { throw new Error("kv down"); }, put: async () => { throw new Error("kv down"); } };
    e.DB = { prepare: (q: string) => ({ bind: (...a: unknown[]) => ({ run: async () => { stored.push(a); return {}; }, all: async () => ({ results: [] }), first: async () => null }) }) };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await post(e, ev(), "1.2.3.4");
    expect(r.status).toBe(202);
    expect(stored.length).toBeGreaterThan(0);
    expect((await reg(e, { app_id: "tide", install_id: "install-kv-reg", shell_version: "1.0.0" }, "1.2.3.4")).status).not.toBe(429);
    err.mockRestore();
  });
});
