import { describe, it, expect } from "vitest";
import app from "../src/index";
import { newInstall } from "./signed";

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
type Tok = { app_id: string; revoked_at?: string | null; expires_at?: string | null };

function setup(healthy = 14, failed = 6, tokens: Record<string, Tok> = {}) {
  const store: Record<string, string> = {};
  const POINTERS = { get: async (k: string) => store[k] ?? null, put: async (k: string, v: string) => { store[k] = v; }, delete: async (k: string) => { delete store[k]; } } as any;
  const DB = { prepare: (sql: string) => ({ bind: (..._a: unknown[]) => ({
    run: async () => ({}),
    first: async () => {
      if (sql.includes("FROM publish_tokens")) { const [h, app_] = _a as string[]; const t = tokens[h]; return t && t.app_id === app_ && !t.revoked_at ? { id: 1, expires_at: t.expires_at ?? null } : null; }
      if (sql.includes("COUNT(DISTINCT install_id) AS installs")) return { installs: failed, nets: 5, fresh_installs: 0, recent: 0 };
      if (sql.includes("COUNT(*) AS n FROM telemetry")) return { n: 0 };
      if (sql.includes("FROM apps")) return { public_key: "k", bytes_used: 0 };
      return null;
    },
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
  it("defaults min_reports to 50 and accepts the bounds", async () => {
    const s = setup();
    expect((await put(s.env, { threshold: 1 })).status).toBe(200);
    expect(JSON.parse(s.store["halt-config/tide"]).min_reports).toBe(50);
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
    const bj = await app.request("/app/tide/api/halt-config", { method: "PUT", headers: H, body: "nope" }, s.env);
    expect(bj.status).toBe(400);
    expect((await bj.json() as any).error).toBe("bad_halt_config");
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
    const inst = await newInstall(s.env);
    const fail = () => inst.send({ schema_version: "1.0", app_id: "tide", release: 5, event: "rolled_back" });
    await fail();
    expect(s.store["halt/tide"]).toBeUndefined();
    await put(s.env, { threshold: 0.2, min_reports: 20, min_installs: 1 });
    await fail();
    expect(JSON.parse(s.store["halt/tide"])).toMatchObject({ release: 5, reports: 20, failed: 6, threshold: 0.2 });
  });
});

describe("halt-config route with a publish token", () => {
  const PUB = "sv_publish_good", OTHER = "sv_publish_other", REVOKED = "sv_publish_revoked", EXPIRED = "sv_publish_expired";
  const mk = async () => setup(14, 6, {
    [await sha(PUB)]: { app_id: "tide" },
    [await sha(OTHER)]: { app_id: "reef" },
    [await sha(REVOKED)]: { app_id: "tide", revoked_at: "2026-01-01T00:00:00Z" },
    [await sha(EXPIRED)]: { app_id: "tide", expires_at: "2000-01-01T00:00:00.000Z" },
  });
  const hdr = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
  const del = (env: any, t: string) => app.request("/app/tide/api/halt-config", { method: "DELETE", headers: hdr(t) }, env);
  const get = (env: any, t: string) => app.request("/app/tide/api/halt-config", { headers: hdr(t) }, env);

  it("lets a valid token for the app GET, PUT and DELETE", async () => {
    const s = await mk();
    expect((await put(s.env, { threshold: 0.3, min_reports: 10 }, hdr(PUB))).status).toBe(200);
    expect(JSON.parse(s.store["halt-config/tide"])).toEqual({ threshold: 0.3, min_reports: 10 });
    const g = await get(s.env, PUB);
    expect(g.status).toBe(200);
    expect(await g.json()).toEqual({ enabled: true, threshold: 0.3, min_reports: 10 });
    expect((await del(s.env, PUB)).status).toBe(200);
    expect(s.store["halt-config/tide"]).toBeUndefined();
  });
  it("rejects another app's, a revoked and an expired token, and writes nothing", async () => {
    for (const t of [OTHER, REVOKED, EXPIRED]) {
      const s = await mk();
      s.store["halt-config/tide"] = JSON.stringify({ threshold: 0.2, min_reports: 20 });
      expect((await get(s.env, t)).status).toBe(401);
      expect((await put(s.env, { threshold: 0.9 }, hdr(t))).status).toBe(401);
      expect((await del(s.env, t)).status).toBe(401);
      expect(JSON.parse(s.store["halt-config/tide"])).toEqual({ threshold: 0.2, min_reports: 20 });
    }
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
