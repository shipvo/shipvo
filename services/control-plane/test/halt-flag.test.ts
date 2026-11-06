import { describe, it, expect } from "vitest";
import app from "../src/index";

function setup(cfg: unknown, healthy: number, failed: number, initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  if (cfg !== undefined) store["halt-config/tide"] = JSON.stringify(cfg);
  const puts: string[] = [];
  const POINTERS = { get: async (k: string) => store[k] ?? null, put: async (k: string, v: string) => { store[k] = v; puts.push(k); } } as any;
  const binds: unknown[][] = [];
  const DB = { prepare: (sql: string) => ({ bind: (...a: unknown[]) => (binds.push(a), {
    run: async () => ({}),
    all: async () => ({ results: sql.includes("verified = 1") ? [...Array.from({ length: healthy }, (_, i) => ({ install_id: "h" + i, net_hash: "n" + (i % 3), failed: 0, healthy: 1 })), ...Array.from({ length: failed }, (_, i) => ({ install_id: "f" + i, net_hash: "n" + (i % 3), failed: 1, healthy: 0 }))] : [] }),
  }) }) } as any;
  return { env: { POINTERS, DB } as any, store, puts, binds };
}
const fail = (env: any) => app.request("/t", { method: "POST", body: JSON.stringify({ schema_version: "1.0", app_id: "tide", release: 5, event: "rolled_back" }) }, env);

describe("halt flag on POST /t", () => {
  it("does nothing without halt-config", async () => {
    const s = setup(undefined, 14, 6);
    expect((await fail(s.env)).status).toBe(202);
    expect(s.store["halt/tide"]).toBeUndefined();
  });
  it("writes halt/<app> at 20 reports over threshold", async () => {
    const s = setup({ threshold: 0.2, min_reports: 20 }, 14, 6);
    await fail(s.env);
    const h = JSON.parse(s.store["halt/tide"]);
    expect(h).toMatchObject({ release: 5, reports: 20, failed: 6, threshold: 0.2 });
    expect(Number.isNaN(Date.parse(h.halted_at))).toBe(false);
  });
  it("does not halt at 19 reports", async () => {
    const s = setup({ threshold: 0.2, min_reports: 20 }, 13, 6);
    await fail(s.env);
    expect(s.store["halt/tide"]).toBeUndefined();
  });
  it("defaults min_reports to 20", async () => {
    const s = setup({ threshold: 0.2 }, 13, 6);
    await fail(s.env);
    expect(s.store["halt/tide"]).toBeUndefined();
  });
  it("keeps halted_at on later failures of the same release", async () => {
    const old = JSON.stringify({ release: 5, halted_at: "2026-01-01T00:00:00.000Z", reports: 20, failed: 6, threshold: 0.2 });
    const s = setup({ threshold: 0.2 }, 14, 7, { "halt/tide": old });
    await fail(s.env);
    expect(s.puts.filter((k: string) => !k.includes("_rl/"))).toEqual([]); // rate-limit counters are not halt writes
    expect(s.store["halt/tide"]).toBe(old);
  });
  it("scopes the count query to app and release", async () => {
    const s = setup({ threshold: 0.2 }, 14, 6);
    await fail(s.env);
    expect(s.binds.some((b) => b[0] === "tide" && b[1] === 5 && b.length === 2)).toBe(true);
  });
  it("replaces the halt of a different release", async () => {
    const s = setup({ threshold: 0.2 }, 14, 6, { "halt/tide": JSON.stringify({ release: 4, halted_at: "2026-01-01T00:00:00.000Z" }) });
    await fail(s.env);
    expect(JSON.parse(s.store["halt/tide"]).release).toBe(5);
  });
  it("writes nothing for a malformed halt-config", async () => {
    for (const bad of ["not json", { threshold: "0.2" }]) {
      const s = setup(undefined, 14, 6, { "halt-config/tide": typeof bad === "string" ? bad : JSON.stringify(bad) });
      expect((await fail(s.env)).status).toBe(202);
      expect(s.store["halt/tide"]).toBeUndefined();
    }
  });
  it("still returns 202 when the halt check throws", async () => {
    const s = setup({ threshold: 0.2 }, 14, 6);
    s.env.POINTERS.get = async () => { throw new Error("kv down"); };
    expect((await fail(s.env)).status).toBe(202);
  });
});

describe("halt query", () => {
  it("counts only verified rows", async () => {
    const sqls: string[] = [];
    const s = setup({ threshold: 0.2 }, 14, 6);
    const prepare = s.env.DB.prepare;
    s.env.DB.prepare = (sql: string) => (sqls.push(sql), prepare(sql));
    await fail(s.env);
    expect(sqls.some((q) => q.includes("t.verified = 1") && q.includes("GROUP BY t.install_id"))).toBe(true);
  });
  it("does not halt when failures come from fewer than 3 networks", async () => {
    const s = setup({ threshold: 0.2 }, 0, 0);
    s.env.DB.prepare = () => ({ bind: () => ({ run: async () => ({}), all: async () => ({ results: Array.from({ length: 30 }, (_, i) => ({ install_id: "f" + i, net_hash: "n" + (i % 2), failed: 1, healthy: 0 })) }) }) });
    await fail(s.env);
    expect(s.store["halt/tide"]).toBeUndefined();
  });
});
