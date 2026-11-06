import { describe, it, expect, vi } from "vitest";
import app from "../src/index";

function kvStore(init: Record<string, string> = {}) {
  const m: Record<string, string> = { ...init };
  return { m, kv: {
    get: async (k: string) => m[k] ?? null,
    put: async (k: string, v: string) => { m[k] = v; },
    list: async ({ prefix }: { prefix: string }) => ({ keys: Object.keys(m).filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  } as any };
}
const failingDb = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("D1_ERROR: daily limit"); }, all: async () => { throw new Error("D1_ERROR: daily limit"); } }) }) } as any;
const post = (body: unknown, env: any) => app.request("/t", { method: "POST", body: JSON.stringify(body) }, env);
const day = new Date().toISOString().slice(0, 10);

describe("telemetry when D1 refuses writes", () => {
  it("returns 202 stored:false and counts the drop", async () => {
    const { m, kv } = kvStore();
    const r = await post({ schema_version: "1.0", app_id: "tide", release: 3, event: "applied" }, { DB: failingDb, POINTERS: kv });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ ok: true, stored: false });
    expect(m[`telemetry_dropped/tide/${day}`]).toBe("1");
    const h = await (await app.request("/health", {}, { DB: failingDb, POINTERS: kv } as any)).json() as any;
    expect(h.telemetry_dropped_today).toBe(1);
  });
  it("does not halt from the KV count: those reports are not verified", async () => {
    const { m, kv } = kvStore({ "halt-config/tide": JSON.stringify({ threshold: 0.2, min_reports: 5 }) });
    for (let i = 0; i < 50; i++) await post({ schema_version: "1.0", app_id: "tide", release: 7, event: "rolled_back" }, { DB: failingDb, POINTERS: kv });
    expect(m["halt/tide"]).toBeUndefined();
    expect(m[`telemetry_dropped/tide/${day}`]).toBe("50");
  });
  it("does not halt a healthy release when D1 is down and healthy events dominate", async () => {
    const { m, kv } = kvStore({ "halt-config/tide": JSON.stringify({ threshold: 0.2, min_reports: 5 }) });
    for (let i = 0; i < 95; i++) await post({ schema_version: "1.0", app_id: "tide", release: 9, event: "applied" }, { DB: failingDb, POINTERS: kv });
    for (let i = 0; i < 6; i++) {
      const r = await post({ schema_version: "1.0", app_id: "tide", release: 9, event: "rolled_back" }, { DB: failingDb, POINTERS: kv });
      expect(r.status).toBe(202);
    }
    expect(m["halt/tide"]).toBeUndefined();
    expect(m["telemetry_failed/tide/9"]).toBeUndefined();
    expect(m[`telemetry_dropped/tide/${day}`]).toBe("101");
  });
  it("a dropped non-failure event writes no telemetry_failed key", async () => {
    const { m, kv } = kvStore();
    const r = await post({ schema_version: "1.0", app_id: "tide", release: 3, event: "applied" }, { DB: failingDb, POINTERS: kv });
    expect(r.status).toBe(202);
    expect(Object.keys(m).some((k) => k.startsWith("telemetry_failed/"))).toBe(false);
  });
  it("returns 202 stored:false with POINTERS unset", async () => {
    const r = await post({ schema_version: "1.0", app_id: "tide", release: 3, event: "rolled_back" }, { DB: failingDb });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ ok: true, stored: false });
  });
  it("/health reads one day-total key, not a KV list", async () => {
    const { m, kv } = kvStore({ [`telemetry_dropped_total/${day}`]: "4" });
    const list = vi.fn(kv.list); kv.list = list;
    const h = await (await app.request("/health", {}, { DB: failingDb, POINTERS: kv } as any)).json() as any;
    expect(h.telemetry_dropped_today).toBe(4);
    expect(list).not.toHaveBeenCalled();
    expect(m).toBeDefined();
  });
  it("/health reports null without POINTERS", async () => {
    const h = await (await app.request("/health", {}, { DB: failingDb } as any)).json() as any;
    expect(h.telemetry_dropped_today).toBeNull();
  });
});
