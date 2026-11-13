import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import app from "../src/index";
import { buildHealth, HEALTH_SQL } from "../src/release-health";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const KEY = "sv_publish_tide";
const H = { authorization: `Bearer ${KEY}` };
const ptr = (release: number) => JSON.stringify({ body: JSON.stringify({ release }), signature: "x" });

// Seeded Android and iOS telemetry, as the grouped rows the query returns.
const rows = [
  { release: 7, platform: "android", event: "applied", n: 40 },
  { release: 7, platform: "android", event: "crash_loop_revert", n: 3 },
  { release: 7, platform: "ios", event: "applied", n: 25 },
  { release: 7, platform: "ios", event: "content_applied", n: 5 },
  { release: 7, platform: "ios", event: "verify_failed", n: 2 },
  { release: 6, platform: "android", event: "applied", n: 90 },
  { release: 6, platform: "ios", event: "applied", n: 80 },
];
function env(role: string | null, seedRows = rows) {
  const store: Record<string, string> = {
    "p/tide/1/b0": ptr(7), "p/tide/1/b1": ptr(7), "p/tide/1/b2": ptr(6),
    "p/tide/1/ios/b0": ptr(7), "p/tide/1/ios/b2": ptr(6),
    "halt/tide": JSON.stringify({ release: 7, halted_at: "2026-11-13T00:00:00Z" }),
  };
  const DB = { prepare: (sql: string) => ({ bind: (...a: unknown[]) => ({
    first: async () => {
      if (sql.includes("FROM publish_tokens")) return a[0] === (await sha(KEY)) ? { id: 1, expires_at: null, role } : null;
      if (sql.includes("FROM apps")) return { public_key: "k", bytes_used: 0 };
      return null;
    },
    all: async () => ({ results: sql.includes("FROM telemetry") ? seedRows : [] }),
    run: async () => ({}),
  }) }) } as any;
  const POINTERS = { get: async (k: string) => store[k] ?? null, put: async () => {}, list: async ({ prefix }: any) => ({ keys: Object.keys(store).filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
  return { DB, POINTERS } as any;
}

describe("buildHealth", () => {
  it("counts per platform and lists bands, newest release first", () => {
    const out = buildHealth(rows as any, { android: { b0: 7, b1: 7, b2: 6 }, ios: { b0: 7, b2: 6 } }, 7);
    expect(out.map((r) => r.release)).toEqual([7, 6]);
    expect(out[0]!.platforms.android).toMatchObject({ applied: 40, healthy: 40, reverted: 3, failed: 3, bands: ["b0", "b1"], halted_bands: ["b0", "b1"] });
    expect(out[0]!.platforms.ios).toMatchObject({ applied: 30, healthy: 30, reverted: 0, failed: 2, bands: ["b0"], halted_bands: ["b0"] });
    expect(out[1]!.halted).toBe(false);
    expect(out[1]!.platforms.ios).toMatchObject({ applied: 80, bands: ["b2"], halted_bands: [] });
  });
});

describe("GET /health/:app/releases", () => {
  it("answers Android and iOS health for a publish token", async () => {
    const res = await app.request("/health/tide/releases", { headers: H }, env("viewer"));
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.app).toBe("tide");
    expect(j.releases[0]).toMatchObject({ release: 7, halted: true });
    expect(j.releases[0].platforms.android.reverted).toBe(3);
    expect(j.releases[0].platforms.ios.applied).toBe(30);
    expect(j.releases[1].platforms.android.bands).toEqual(["b2"]);
  });
  it("401 without a token, 403 for a role that may not read", async () => {
    expect((await app.request("/health/tide/releases", {}, env(null))).status).toBe(401);
    expect((await app.request("/health/tide/releases", { headers: H }, env("nobody"))).status).toBe(403);
  });
  it("400 on a bad app id", async () => {
    expect((await app.request("/health/Bad_App!/releases", { headers: H }, env(null))).status).toBe(400);
  });
});

describe("HEALTH_SQL on real SQLite", () => {
  function seeded() {
    const sql = new DatabaseSync(":memory:");
    sql.exec("CREATE TABLE telemetry (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id, release, event, device_model, android_api, verified INTEGER NOT NULL DEFAULT 0)");
    const ins = sql.prepare("INSERT INTO telemetry (app_id, release, event, device_model, android_api, verified) VALUES ('tide', ?, ?, ?, ?, ?)");
    const add = (n: number, release: number, event: string, model: string | null, api: number | null, verified = 1) => { for (let i = 0; i < n; i++) ins.run(release, event, model, api, verified); };
    add(4, 7, "applied", null, 34);            // Android as the runtime sends it: API level, no model
    add(1, 7, "crash_loop_revert", null, 34);
    add(3, 7, "applied", "iPhone15,2", null);  // iOS with an Apple model
    add(2, 7, "content_applied", null, null);  // iOS as the runtime sends it today: both NULL
    add(9, 7, "applied", null, 34, 0);         // unverified: excluded
    return sql;
  }
  const db = (sql: any) => ({ prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = { bind: (...a: any[]) => { b = a; return o; }, all: async () => ({ results: st.all(...b) }), first: async () => null, run: async () => ({}) }; return o; } }) as any;
  it("splits Android, iOS and unattributed rows and drops unverified ones", async () => {
    const res = await app.request("/health/tide/releases", { headers: H }, { ...env("viewer"), DB: (() => { const e = env("viewer").DB; const real = db(seeded()); return { prepare: (q: string) => q.includes("FROM telemetry") ? real.prepare(q) : e.prepare(q) }; })() });
    const j: any = await res.json();
    const p = j.releases.find((r: any) => r.release === 7).platforms;
    expect(p.android).toMatchObject({ applied: 4, reverted: 1, failed: 1 });
    expect(p.ios).toMatchObject({ applied: 3 });
    expect(p.unknown).toMatchObject({ applied: 2 });
  });
  it("is plain SQL over the telemetry table", () => {
    expect(seeded().prepare(HEALTH_SQL).all("tide", "tide").length).toBe(4);
  });
});

describe("app with no telemetry", () => {
  it("returns 200 with no releases", async () => {
    const res = await app.request("/health/tide/releases", { headers: H }, { ...env("viewer", []), POINTERS: undefined });
    expect(res.status).toBe(200);
    expect((await res.json() as any).releases).toEqual([]);
  });
});
