import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import app from "../src/index";
import { newInstall } from "./signed";

function setup(cfg: unknown, healthy: number, failed: number, initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  if (cfg !== undefined) store["halt-config/tide"] = JSON.stringify({ min_installs: 1, ...(cfg as object) });
  const puts: string[] = [];
  const POINTERS = { get: async (k: string) => store[k] ?? null, put: async (k: string, v: string) => { store[k] = v; puts.push(k); } } as any;
  const binds: unknown[][] = [];
  const DB = { prepare: (sql: string) => ({ bind: (...a: unknown[]) => (binds.push(a), {
    run: async () => ({}),
    first: async () => {
      if (sql.includes("'applied'")) return { n: healthy };
      if (sql.includes("COUNT(DISTINCT install_id) AS installs")) return { installs: failed, nets: 5, fresh_installs: 0, recent: 0 };
      if (sql.includes("COUNT(*) AS n FROM telemetry")) return { n: 0 };
      return null;
    },
    all: async () => ({ results: sql.includes("GROUP BY event") ? [{ event: "applied", n: healthy }, { event: "rolled_back", n: failed }] : [] }),
  }) }) } as any;
  return { env: { POINTERS, DB, OWNER_TOKEN: "secret" } as any, store, puts, binds };
}
const installs = new WeakMap<object, ReturnType<typeof newInstall>>();
const fail = async (env: any) => {
  if (!installs.has(env)) installs.set(env, newInstall(env));
  return (await installs.get(env)!).send({ schema_version: "1.0", app_id: "tide", release: 5, event: "rolled_back" });
};

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
  it("defaults min_reports to 50", async () => {
    const s = setup({ threshold: 0.2 }, 37, 12);
    await fail(s.env);
    expect(s.store["halt/tide"]).toBeUndefined();
    const t = setup({ threshold: 0.2 }, 38, 12);
    await fail(t.env);
    expect(JSON.parse(t.store["halt/tide"]).reports).toBe(50);
  });
  it("min_reports counts installs: 30 failing installs do not halt at min_reports 50", async () => {
    const s = setup({ threshold: 0.2, min_reports: 50 }, 10, 30);
    await fail(s.env);
    expect(s.store["halt/tide"]).toBeUndefined();
  });
  it("a hand-edited min_installs of 0 still needs one failing install", async () => {
    const s = setup({ threshold: 0.2, min_reports: 1, min_installs: 0 }, 0, 0);
    await fail(s.env);
    expect(s.store["halt/tide"]).toBeUndefined();
  });
  it("keeps halted_at on later failures of the same release", async () => {
    const old = JSON.stringify({ release: 5, halted_at: "2026-01-01T00:00:00.000Z", reports: 20, failed: 6, threshold: 0.2 });
    const s = setup({ threshold: 0.2, min_reports: 20 }, 14, 7, { "halt/tide": old });
    await fail(s.env);
    expect(s.puts.filter((k) => !/^(rl|seen|install)\//.test(k))).toEqual([]);
    expect(s.store["halt/tide"]).toBe(old);
  });
  it("scopes the count query to app and release", async () => {
    const s = setup({ threshold: 0.2 }, 14, 6);
    await fail(s.env);
    expect(s.binds.some((b) => b[0] === "tide" && b[1] === 5 && b.length === 2 && b[0] === "tide")).toBe(true);
  });
  it("replaces the halt of a different release", async () => {
    const s = setup({ threshold: 0.2, min_reports: 20 }, 14, 6, { "halt/tide": JSON.stringify({ release: 4, halted_at: "2026-01-01T00:00:00.000Z" }) });
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
    const inst = await newInstall(s.env);
    s.env.POINTERS.get = async () => { throw new Error("kv down"); };
    expect((await inst.send({ schema_version: "1.0", app_id: "tide", release: 5, event: "rolled_back" })).status).toBe(202);
  });
});

describe("migration 0019", () => {
  it("is additive", () => {
    const sql = readFileSync(new URL("../migrations/0019_telemetry_trust.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/ALTER TABLE telemetry ADD COLUMN verified/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/);
    expect(sql).not.toMatch(/\b(DROP|RENAME|DELETE|UPDATE)\b/i);
  });
});
