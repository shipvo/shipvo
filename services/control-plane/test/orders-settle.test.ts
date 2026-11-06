import { describe, it, expect } from "vitest";
import app from "../src/index";
import { adminPage } from "../src/admin";

function fake(statuses: Record<string, string[]>, opts: { changes?: number } = {}) {
  const rows = Object.entries(statuses).flatMap(([order_id, ss]) => ss.map((status) => ({ app_id: "tide", order_id, status })));
  const audit: any[][] = [];
  const DB = { prepare: (sql: string) => ({ bind: (...a: any[]) => ({
    first: async () => (/publish_tokens/.test(sql) ? { id: 1, expires_at: null, role: "publish" } : null),
    all: async () => ({ results: rows.filter((r) => r.app_id === a[0] && r.order_id === a[1]).map((r) => ({ status: r.status })) }),
    run: async () => {
      if (/^UPDATE orders/.test(sql) && opts.changes === 0) return { meta: { changes: 0 } };
      if (/^UPDATE orders/.test(sql)) rows.filter((r) => r.app_id === a[0] && r.order_id === a[1] && r.status === "unverified").forEach((r) => { r.status = "settled"; });
      if (/^INSERT INTO audit/.test(sql)) audit.push(a);
      return { meta: { changes: 1 } };
    },
  }) }) } as any;
  return { rows, audit, env: { DB, OWNER_TOKEN: "owner-secret", ADMIN_PASSWORD: "pw", POINTERS: {} } as any };
}
const settle = (env: any, id: string, token?: string, cookie?: string) =>
  app.request(`/app/tide/api/orders/${id}/settle`, { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}) } }, env);
async function adminCookie(appId: string, exp = Date.now() + 60_000) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("pw"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${appId}.${exp}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pn_admin=${appId}.${exp}.${sig}`;
}

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
    for (const t of [undefined, "wrong", "sv_publish_realtoken"]) expect((await settle(env, "A", t)).status).toBe(401);
    expect(rows[0].status).toBe("unverified");
    expect(audit).toHaveLength(0);
  });
  it("settles with a valid admin session cookie", async () => {
    const { rows, audit, env } = fake({ A: ["unverified"] });
    const r = await settle(env, "A", undefined, await adminCookie("tide"));
    expect(r.status).toBe(200);
    expect(rows[0].status).toBe("settled");
    expect(audit[0][2]).toBe("owner (admin)");
  });
  it("refuses an admin cookie issued for another app", async () => {
    const { rows, audit, env } = fake({ A: ["unverified"] });
    expect((await settle(env, "A", undefined, await adminCookie("other"))).status).toBe(401);
    expect(rows[0].status).toBe("unverified");
    expect(audit).toHaveLength(0);
  });
  it("does not audit when the UPDATE changed nothing (concurrent settle)", async () => {
    const { audit, env } = fake({ A: ["unverified"] }, { changes: 0 });
    const r = await settle(env, "A", "owner-secret");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ already_settled: true });
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
  it("payLabel falls back to Not paid for an unknown status", () => {
    const html = adminPage("tide");
    const src = html.slice(html.indexOf("const PAY="), html.indexOf("async function renderOrders"));
    const payLabel = new Function(`${src}; return payLabel;`)();
    const out = payLabel("weird");
    expect(out).toContain("Not paid");
    expect(out).not.toContain("Paid (");
  });
});
