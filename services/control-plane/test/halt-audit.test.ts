import { describe, it, expect, vi } from "vitest";
import { newInstall } from "./signed";

function setup(failAudit: boolean) {
  const store: Record<string, string> = { "halt-config/tide": JSON.stringify({ threshold: 0.2, min_reports: 20, min_installs: 1 }) };
  const POINTERS = { get: async (k: string) => store[k] ?? null, put: async (k: string, v: string) => { store[k] = v; } } as any;
  const audits: unknown[][] = [];
  const DB = { prepare: (sql: string) => ({ bind: (...a: unknown[]) => ({
    run: async () => { if (sql.includes("INSERT INTO audit_log")) { if (failAudit) throw new Error("db down"); audits.push(a); } return {}; },
    first: async () => sql.includes("AS installs") ? { installs: 6, nets: 5, fresh_installs: 0, recent: 0 } : sql.includes("COUNT(*) AS n FROM telemetry") ? { n: 0 } : null,
    all: async () => ({ results: sql.includes("GROUP BY event") ? [{ event: "applied", n: 14 }, { event: "rolled_back", n: 6 }] : [] }),
  }) }) } as any;
  return { env: { POINTERS, DB, OWNER_TOKEN: "secret" } as any, store, audits };
}
const fail = async (env: any) => (await newInstall(env)).send({ schema_version: "1.0", app_id: "tide", release: 5, event: "rolled_back" });

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
