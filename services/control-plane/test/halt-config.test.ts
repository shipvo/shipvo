import { describe, it, expect } from "vitest";
import app from "../src/index";

function setup(healthy = 14, failed = 6) {
  const store: Record<string, string> = {};
  const POINTERS = { get: async (k: string) => store[k] ?? null, put: async (k: string, v: string) => { store[k] = v; }, delete: async (k: string) => { delete store[k]; } } as any;
  const DB = { prepare: (sql: string) => ({ bind: (..._a: unknown[]) => ({
    run: async () => ({}),
    first: async () => null,
    all: async () => ({ results: sql.includes("GROUP BY event") ? [{ event: "applied", n: healthy }, { event: "rolled_back", n: failed }] : [] }),
  }) }) } as any;
  return { env: { POINTERS, DB, OWNER_TOKEN: "tok" } as any, store };
}
const H = { authorization: "Bearer tok", "content-type": "application/json" };
const put = (env: any, body: unknown, headers: Record<string, string> = H) =>
  app.request("/app/tide/api/halt-config", { method: "PUT", headers, body: JSON.stringify(body) }, env);

describe("halt-config route", () => {
  it("rejects unauthenticated calls and writes nothing", async () => {
    const s = setup();
    expect((await put(s.env, { threshold: 0.2 }, {})).status).toBe(401);
    expect((await put(s.env, { threshold: 0.2 }, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await app.request("/app/tide/api/halt-config", {}, s.env)).status).toBe(401);
    expect((await app.request("/app/tide/api/halt-config", { method: "DELETE" }, s.env)).status).toBe(401);
    expect(s.store["halt-config/tide"]).toBeUndefined();
  });
  it("stores valid values and reads them back", async () => {
    const s = setup();
    const r = await put(s.env, { threshold: 0.2, min_reports: 20 });
    expect(r.status).toBe(200);
    expect(JSON.parse(s.store["halt-config/tide"])).toEqual({ threshold: 0.2, min_reports: 20 });
    const g = await app.request("/app/tide/api/halt-config", { headers: H }, s.env);
    expect(await g.json()).toEqual({ enabled: true, threshold: 0.2, min_reports: 20 });
  });
  it("defaults min_reports to 20 and accepts the bounds", async () => {
    const s = setup();
    expect((await put(s.env, { threshold: 1 })).status).toBe(200);
    expect(JSON.parse(s.store["halt-config/tide"]).min_reports).toBe(20);
    expect((await put(s.env, { threshold: 0.01, min_reports: 10000 })).status).toBe(200);
    expect((await put(s.env, { threshold: 0.5, min_reports: 1 })).status).toBe(200);
  });
  it("rejects invalid values with a typed 400", async () => {
    const s = setup();
    for (const b of [{}, { threshold: 0 }, { threshold: -0.1 }, { threshold: 1.1 }, { threshold: "0.2" }, { threshold: 0.2, min_reports: 0 },
      { threshold: 0.2, min_reports: 10001 }, { threshold: 0.2, min_reports: 1.5 }, { threshold: 0.2, min_reports: "5" }]) {
      const r = await put(s.env, b);
      expect(r.status).toBe(400);
      expect((await r.json() as any).error).toBe("bad_halt_config");
    }
    expect((await app.request("/app/tide/api/halt-config", { method: "PUT", headers: H, body: "nope" }, s.env)).status).toBe(400);
    expect(s.store["halt-config/tide"]).toBeUndefined();
  });
  it("turns off with DELETE, and GET says off", async () => {
    const s = setup();
    await put(s.env, { threshold: 0.2 });
    expect((await app.request("/app/tide/api/halt-config", { method: "DELETE", headers: H }, s.env)).status).toBe(200);
    expect(s.store["halt-config/tide"]).toBeUndefined();
    expect(await (await app.request("/app/tide/api/halt-config", { headers: H }, s.env)).json()).toEqual({ enabled: false });
  });
  it("halts a failing release after the config is set through the route", async () => {
    const s = setup(14, 6);
    const fail = () => app.request("/t", { method: "POST", body: JSON.stringify({ schema_version: "1.0", app_id: "tide", release: 5, event: "rolled_back" }) }, s.env);
    await fail();
    expect(s.store["halt/tide"]).toBeUndefined();
    await put(s.env, { threshold: 0.2, min_reports: 20 });
    await fail();
    expect(JSON.parse(s.store["halt/tide"])).toMatchObject({ release: 5, reports: 20, failed: 6, threshold: 0.2 });
  });
});

describe("summary auto_halt", () => {
  it("shows the setting, or null when off", async () => {
    const s = setup();
    const get = async () => (await (await app.request("/t/tide/summary", {}, s.env)).json() as any).auto_halt;
    expect(await get()).toBeNull();
    await put(s.env, { threshold: 0.2, min_reports: 20 });
    expect(await get()).toEqual({ threshold: 0.2, min_reports: 20 });
  });
});
