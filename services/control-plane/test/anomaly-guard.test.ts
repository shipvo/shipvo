import { describe, it, expect, vi, afterEach } from "vitest";
import app from "../src/index";
import { adminPage } from "../src/admin";

async function cookie(pw: string, appId: string) {
  const exp = Date.now() + 3600_000;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${appId}.${exp}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pn_admin=${appId}.${exp}.${sig}`;
}
const fresh = new Date(Date.now() - 5 * 60_000).toISOString();
const old = new Date(Date.now() - 30 * 86_400_000).toISOString();

// 20 installs, 6 failing (30% > 20% threshold), from 3 networks. `createdAt` is when the installs registered.
function setup(createdAt: string, rate = { recent: 0, baseline: 0 }) {
  const m: Record<string, string> = { "halt-config/tide": JSON.stringify({ threshold: 0.2, min_reports: 20 }) };
  const POINTERS = {
    get: async (k: string) => m[k] ?? null, put: async (k: string, v: string) => { m[k] = v; }, delete: async (k: string) => { delete m[k]; },
    list: async () => ({ keys: Object.keys(m).map((name) => ({ name })), list_complete: true }),
  } as any;
  const DB = { prepare: (sql: string) => ({ bind: (..._a: unknown[]) => ({
    run: async () => ({}),
    first: async () => (sql.includes("SUM(received_at") ? rate : null),
    all: async () => ({ results: sql.includes("verified = 1") && sql.includes("GROUP BY") ? Array.from({ length: 20 }, (_, i) => ({ install_id: "i" + i, net_hash: "n" + (i % 3), created_at: createdAt, failed: i < 6 ? 1 : 0, healthy: i < 6 ? 0 : 1 })) : [] }),
  }) }) } as any;
  return { m, e: { POINTERS, DB, OWNER_TOKEN: "owner-secret", ADMIN_PASSWORD: "pw" } as any };
}
const fail = (e: any) => app.request("/t", { method: "POST", body: JSON.stringify({ schema_version: "1.0", app_id: "tide", release: 5, event: "rolled_back" }) }, e);
const list = (e: any) => app.request("/app/tide/api/approvals", { headers: { authorization: "Bearer owner-secret" } }, e).then((r) => r.json() as Promise<any>);
const decide = async (e: any, id: string, verb: string) => app.request(`/app/tide/api/approvals/${id}/${verb}`, { method: "POST", headers: { cookie: await cookie("pw", "tide") } }, e);

afterEach(() => vi.restoreAllMocks());
const later = (ms: number) => { const t = Date.now() + ms; vi.spyOn(Date, "now").mockReturnValue(t); };

describe("anomaly guard", () => {
  it("the hold is still pending after 30 minutes and no second entry is added", async () => {
    const { e } = setup(old, { recent: 60, baseline: 144 });
    await fail(e);
    later(30 * 60_000);
    expect((await list(e)).approvals).toHaveLength(1);
    await fail(e);
    expect((await list(e)).approvals).toHaveLength(1);
  });
  it("an expired hold is replaced by a fresh entry on the next failure, and approving the old one does not halt", async () => {
    const { m, e } = setup(old, { recent: 60, baseline: 144 });
    await fail(e);
    const oldId = (await list(e)).approvals[0].id;
    later(25 * 3600_000);
    expect((await list(e)).approvals).toHaveLength(0);
    await fail(e);
    const { approvals } = await list(e);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].id).not.toBe(oldId);
    expect((await decide(e, oldId, "approve")).status).toBe(409);
    expect(m["halt/tide"]).toBeUndefined();
  });
  it("a hold for release B does not break the pending hold for release A", async () => {
    const { m, e } = setup(fresh);
    await fail(e);
    const idA = (await list(e)).approvals[0].id;
    await app.request("/t", { method: "POST", body: JSON.stringify({ schema_version: "1.0", app_id: "tide", release: 6, event: "rolled_back" }) }, e);
    const { approvals } = await list(e);
    expect(approvals).toHaveLength(2);
    expect((await decide(e, idA, "approve")).status).toBe(200);
    expect(JSON.parse(m["halt/tide"]).release).toBe(5);
    expect(m["anomaly-hold/tide/6"]).toBeDefined();
  });
  it("the admin shows a hold in plain words, not as a command to run", () => {
    const html = adminPage("tide");
    for (const t of ["may be under attack", "Halt release", "Keep rolling out", "Release halted.", "Hold cleared."]) expect(html).toContain(t);
  });
  it("confirming a hold leaves a halt of a different release alone", async () => {
    const { m, e } = setup(fresh);
    await fail(e);
    const id = (await list(e)).approvals[0].id;
    m["halt/tide"] = JSON.stringify({ release: 9 });
    expect((await decide(e, id, "approve")).status).toBe(200);
    expect(JSON.parse(m["halt/tide"]).release).toBe(9);
    expect(m["anomaly-hold/tide/5"]).toBeUndefined();
  });
  it("a burst of fresh-install failures is held, not halted, with an approval entry", async () => {
    const { m, e } = setup(fresh);
    expect((await fail(e)).status).toBe(202);
    expect(m["halt/tide"]).toBeUndefined();
    const { approvals } = await list(e);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].command).toBe("anomaly_hold");
    // A second failure while the entry is pending does not add another.
    await fail(e);
    expect((await list(e)).approvals).toHaveLength(1);
  });
  it("a sudden jump in the failure rate is held even from old installs", async () => {
    const { m, e } = setup(old, { recent: 60, baseline: 144 });
    await fail(e);
    expect(m["halt/tide"]).toBeUndefined();
    expect((await list(e)).approvals).toHaveLength(1);
  });
  it("owner confirm halts", async () => {
    const { m, e } = setup(fresh);
    await fail(e);
    const id = (await list(e)).approvals[0].id;
    expect((await decide(e, id, "approve")).status).toBe(200);
    expect(JSON.parse(m["halt/tide"]).release).toBe(5);
    expect(m["anomaly-hold/tide/5"]).toBeUndefined();
  });
  it("owner dismiss clears the hold and halts nothing", async () => {
    const { m, e } = setup(fresh);
    await fail(e);
    const id = (await list(e)).approvals[0].id;
    expect((await decide(e, id, "deny")).status).toBe(200);
    expect(m["halt/tide"]).toBeUndefined();
    expect(m["anomaly-hold/tide/5"]).toBeUndefined();
    expect((await list(e)).approvals).toHaveLength(0);
  });
  it("the owner token cannot confirm a hold", async () => {
    const { m, e } = setup(fresh);
    await fail(e);
    const id = (await list(e)).approvals[0].id;
    expect((await app.request(`/app/tide/api/approvals/${id}/approve`, { method: "POST", headers: { authorization: "Bearer owner-secret" } }, e)).status).toBe(403);
    expect(m["halt/tide"]).toBeUndefined();
  });
  it("normal failures from established installs still halt", async () => {
    const { m, e } = setup(old, { recent: 2, baseline: 288 });
    await fail(e);
    expect(JSON.parse(m["halt/tide"]).release).toBe(5);
    expect((await list(e)).approvals).toHaveLength(0);
  });
});
