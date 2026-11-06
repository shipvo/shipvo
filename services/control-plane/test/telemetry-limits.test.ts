import { describe, it, expect } from "vitest";
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
  it("still halts from the KV count", async () => {
    const { m, kv } = kvStore({ "halt-config/tide": JSON.stringify({ threshold: 0.2, min_reports: 5 }) });
    for (let i = 0; i < 5; i++) {
      const r = await post({ schema_version: "1.0", app_id: "tide", release: 7, event: "rolled_back" }, { DB: failingDb, POINTERS: kv });
      expect(r.status).toBe(202);
      if (i < 4) expect(m["halt/tide"]).toBeUndefined();
    }
    expect(JSON.parse(m["halt/tide"]).release).toBe(7);
    expect(m[`telemetry_dropped/tide/${day}`]).toBe("5");
  });
});
