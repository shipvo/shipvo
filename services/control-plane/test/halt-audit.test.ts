import { describe, it, expect, vi } from "vitest";
import app from "../src/index";

function setup(failAudit: boolean) {
  const store: Record<string, string> = { "halt-config/tide": JSON.stringify({ threshold: 0.2, min_reports: 20 }) };
  const POINTERS = { get: async (k: string) => store[k] ?? null, put: async (k: string, v: string) => { store[k] = v; } } as any;
  const audits: unknown[][] = [];
  const DB = { prepare: (sql: string) => ({ bind: (...a: unknown[]) => ({
    run: async () => { if (sql.includes("INSERT INTO audit_log")) { if (failAudit) throw new Error("db down"); audits.push(a); } return {}; },
    all: async () => ({ results: sql.includes("verified = 1") ? Array.from({ length: 20 }, (_, i) => ({ install_id: "i" + i, net_hash: "n" + (i % 3), failed: i < 6 ? 1 : 0, healthy: i < 6 ? 0 : 1 })) : [] }),
  }) }) } as any;
  return { env: { POINTERS, DB } as any, store, audits };
}
const fail = (env: any) => app.request("/t", { method: "POST", body: JSON.stringify({ schema_version: "1.0", app_id: "tide", release: 5, event: "rolled_back" }) }, env);

describe("automatic halt audit row", () => {
  it("writes one system row for the halt", async () => {
    const s = setup(false);
    expect((await fail(s.env)).status).toBe(202);
    expect(s.audits).toHaveLength(1);
    // args: app_id, at, actor, actor_kind, action, release, release_id, before, after
    expect(s.audits[0].slice(0, 1)).toEqual(["tide"]);
    expect(s.audits[0].slice(2, 6)).toEqual(["halt-rule", "system", "halt", 5]);
    expect(JSON.parse(s.audits[0][8] as string)).toMatchObject({ release: 5, reports: 20, failed: 6 });
  });
  it("a failed audit write changes neither the response nor the halt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup(true);
    expect((await fail(s.env)).status).toBe(202);
    expect(JSON.parse(s.store["halt/tide"]).release).toBe(5);
    warn.mockRestore();
  });
});
