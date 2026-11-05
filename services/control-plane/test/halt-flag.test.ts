import { describe, it, expect } from "vitest";
import app from "../src/index";

function setup(cfg: unknown, healthy: number, failed: number, initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  if (cfg !== undefined) store["halt-config/tide"] = JSON.stringify(cfg);
  const puts: string[] = [];
  const POINTERS = { get: async (k: string) => store[k] ?? null, put: async (k: string, v: string) => { store[k] = v; puts.push(k); } } as any;
  const DB = { prepare: (sql: string) => ({ bind: () => ({
    run: async () => ({}),
    all: async () => ({ results: sql.includes("GROUP BY event") ? [{ event: "applied", n: healthy }, { event: "rolled_back", n: failed }] : [] }),
  }) }) } as any;
  return { env: { POINTERS, DB } as any, store, puts };
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
    expect(s.puts).toEqual([]);
    expect(s.store["halt/tide"]).toBe(old);
  });
});
