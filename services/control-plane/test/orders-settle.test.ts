import { describe, it, expect } from "vitest";
import app from "../src/index";
import { adminPage } from "../src/admin";

function fake(statuses: Record<string, string[]>) {
  const rows = Object.entries(statuses).flatMap(([order_id, ss]) => ss.map((status) => ({ app_id: "tide", order_id, status })));
  const audit: any[][] = [];
  const DB = { prepare: (sql: string) => ({ bind: (...a: any[]) => ({
    all: async () => ({ results: rows.filter((r) => r.app_id === a[0] && r.order_id === a[1]).map((r) => ({ status: r.status })) }),
    run: async () => {
      if (/^UPDATE orders/.test(sql)) rows.filter((r) => r.app_id === a[0] && r.order_id === a[1] && r.status === "unverified").forEach((r) => { r.status = "settled"; });
      if (/^INSERT INTO audit/.test(sql)) audit.push(a);
      return { meta: { changes: 1 } };
    },
  }) }) } as any;
  return { rows, audit, env: { DB, OWNER_TOKEN: "owner-secret", POINTERS: {} } as any };
}
const settle = (env: any, id: string, token?: string) =>
  app.request(`/app/tide/api/orders/${id}/settle`, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} }, env);

describe("settle order", () => {
  it("settles with the owner token, once, and audits it", async () => {
    const { rows, audit, env } = fake({ A: ["unverified"] });
    const r = await settle(env, "A", "owner-secret");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "settled" });
    expect(rows[0].status).toBe("settled");
    expect(audit).toHaveLength(1);
    expect(audit[0][3]).toBe("settle_order");
  });
  it("is idempotent: a second call succeeds, changes nothing and adds no audit row", async () => {
    const { audit, env } = fake({ A: ["unverified"] });
    await settle(env, "A", "owner-secret");
    const r = await settle(env, "A", "owner-secret");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "settled", already_settled: true });
    expect(audit).toHaveLength(1);
  });
  it("refuses no token, a wrong token and a publish token, and changes nothing", async () => {
    const { rows, audit, env } = fake({ A: ["unverified"] });
    for (const t of [undefined, "wrong", "publish-token"]) expect((await settle(env, "A", t)).status).toBe(401);
    expect(rows[0].status).toBe("unverified");
    expect(audit).toHaveLength(0);
  });
  it("does not settle simulated or price_mismatch orders", async () => {
    const { rows, env } = fake({ S: ["simulated"], P: ["price_mismatch"] });
    expect((await settle(env, "S", "owner-secret")).status).toBe(409);
    expect((await settle(env, "P", "owner-secret")).status).toBe(409);
    expect(rows.map((r) => r.status)).toEqual(["simulated", "price_mismatch"]);
  });
  it("returns 404 for an unknown order", async () => {
    const { env } = fake({});
    expect((await settle(env, "nope", "owner-secret")).status).toBe(404);
  });
});

describe("admin order labels", () => {
  it("names all four statuses and never calls unverified or simulated paid", () => {
    const html = adminPage("tide");
    for (const s of ["settled", "unverified", "price_mismatch", "simulated"]) expect(html).toContain(`['${s}'`);
    expect(html).toContain("Not paid: payment not checked");
    expect(html).toContain("Test order, not real");
    expect(html).toContain("Paid (settled by you)");
  });
});
