import { describe, it, expect } from "vitest";
import app from "../src/index";
import { adminPage } from "../src/admin";

const content = {
  version: 3,
  products: [{ id: "rod", department: "rods", price: 1000 }, { id: "line", department: "line", price: 500 }],
  promos: [{ code: "TEN", percent: 10, min_subtotal: 1000, active: true }, { code: "OLD", percent: 50, min_subtotal: 0, active: false }],
  slots: [{ id: "mon", fee: 200 }],
};
type Row = Record<string, any>;
/** A tiny in-memory orders table that understands just the queries the routes make. */
function fake() {
  const rows: Row[] = [];
  const DB = { prepare: (sql: string) => ({ bind: (...a: any[]) => ({
    first: async () => {
      if (sql.includes("FROM content_versions")) return a[1] === 3 ? { json: JSON.stringify(content) } : null;
      if (sql.startsWith("SELECT status")) return rows.find((r) => r.app_id === a[0] && r.order_id === a[1]) ?? null;
      if (sql.includes("COUNT(*)")) { const col = sql.includes("ip_hash") ? "ip_hash" : "install"; return { n: rows.filter((r) => r.app_id === a[0] && r[col] === a[1]).length }; }
      return null;
    },
    run: async () => {
      if (sql.startsWith("INSERT INTO orders")) { if (!rows.some((r) => r.app_id === a[0] && r.order_id === a[1])) rows.push({ app_id: a[0], order_id: a[1], total: a[2], json: a[3], status: a[4], simulated: a[5], ip_hash: a[6], install: a[7] }); }
      if (sql.startsWith("UPDATE orders")) { const r = rows.find((x) => x.app_id === a[2] && x.order_id === a[3] && x.status === "unverified"); if (r) { r.status = "settled"; r.settled_at = a[0]; } }
      return {};
    },
  }) }) } as any;
  return { DB, rows, env: { DB, POINTERS: { get: async () => null }, OWNER_TOKEN: "tok" } as any };
}
const good = (id = "TT-1") => ({ id, lines: [{ product_id: "rod", quantity: 2, unit_price: 1000 }], subtotal: 2000, discount: 200, delivery_fee: 200, total: 2000, promo: "TEN", slot_id: "mon" });
const place = (env: any, order: any, extra: any = {}, headers: any = {}) =>
  app.request("/o/tide", { method: "POST", headers, body: JSON.stringify({ order, content_version: 3, ...extra }) }, env);
const settle = (env: any, id: string, auth?: string) =>
  app.request(`/app/tide/api/orders/${id}/settle`, { method: "POST", headers: auth ? { authorization: auth } : {}, body: "{}" }, env);

describe("POST /o/:app trust rules", () => {
  it("stores a correctly priced order as unverified, never settled", async () => {
    const { env, rows } = fake();
    const r = await place(env, good());
    expect(r.status).toBe(202);
    expect(((await r.json()) as any).status).toBe("unverified");
    expect(rows[0].status).toBe("unverified");
  });
  it("returns the first result for a duplicate id and stores nothing new", async () => {
    const { env, rows } = fake();
    await place(env, good());
    const r = await place(env, { ...good(), total: 1 });
    expect(r.status).toBe(202);
    expect(((await r.json()) as any).duplicate).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(2000);
  });
  it("marks a tampered total as price_mismatch and answers 422", async () => {
    const { env, rows } = fake();
    const r = await place(env, { ...good(), total: 1 });
    expect(r.status).toBe(422);
    expect(rows[0].status).toBe("price_mismatch");
    expect(rows[0].json).toContain("price_errors");
  });
  it("catches a tampered unit price, a dead promo, an unknown slot and an unknown content version", async () => {
    const { env, rows } = fake();
    const o = good();
    expect((await place(env, { ...o, id: "a", lines: [{ product_id: "rod", quantity: 2, unit_price: 1 }], total: 400 })).status).toBe(422);
    expect((await place(env, { ...o, id: "b", promo: "OLD", total: 1000 })).status).toBe(422);
    expect((await place(env, { ...o, id: "c", slot_id: "nope" })).status).toBe(422);
    expect((await place(env, { ...o, id: "d" }, { content_version: 99 })).status).toBe(422);
    expect(rows.every((r) => r.status === "price_mismatch")).toBe(true);
  });
  it("labels simulated orders and does not price-check them as real", async () => {
    const { env, rows } = fake();
    await place(env, { ...good(), total: 5 }, { simulated: true });
    expect(rows[0].status).toBe("simulated");
    expect(rows[0].simulated).toBe(1);
    expect((await settle(env, "TT-1", "Bearer tok")).status).toBe(409);
  });
  it("rate limits per install and per IP", async () => {
    const a = fake();
    for (let i = 0; i < 10; i++) expect((await place(a.env, good("i" + i), { install_id: "x" })).status).toBe(202);
    expect((await place(a.env, good("i10"), { install_id: "x" })).status).toBe(429);
    expect((await place(a.env, good("i11"), { install_id: "y" })).status).toBe(202);
    const b = fake();
    for (let i = 0; i < 20; i++) await place(b.env, good("p" + i), {}, { "cf-connecting-ip": "1.2.3.4" });
    expect((await place(b.env, good("p20"), {}, { "cf-connecting-ip": "1.2.3.4" })).status).toBe(429);
    expect((await place(b.env, good("p21"), {}, { "cf-connecting-ip": "5.6.7.8" })).status).toBe(202);
  });
  it("rejects an order id that is missing or too long", async () => {
    const { env } = fake();
    expect((await place(env, { ...good(), id: "" })).status).toBe(400);
    expect((await place(env, { ...good(), id: "x".repeat(41) })).status).toBe(400);
  });
});

describe("POST /app/:id/api/orders/:order/settle", () => {
  it("refuses without the owner token", async () => {
    const { env, rows } = fake();
    await place(env, good());
    expect((await settle(env, "TT-1")).status).toBe(401);
    expect((await settle(env, "TT-1", "Bearer wrong")).status).toBe(401);
    expect(rows[0].status).toBe("unverified");
  });
  it("settles an unverified order once, and is safe to repeat", async () => {
    const { env, rows } = fake();
    await place(env, good());
    expect((await settle(env, "TT-1", "Bearer tok")).status).toBe(200);
    expect(rows[0].status).toBe("settled");
    expect(((await (await settle(env, "TT-1", "Bearer tok")).json()) as any).already).toBe(true);
    expect((await settle(env, "nope", "Bearer tok")).status).toBe(404);
  });
  it("will not settle a price_mismatch order", async () => {
    const { env } = fake();
    await place(env, { ...good(), total: 1 });
    expect((await settle(env, "TT-1", "Bearer tok")).status).toBe(409);
  });
});

describe("admin order labels", () => {
  const page = adminPage("tide");
  it("labels every status and never calls an unverified order paid", () => {
    expect(page).toContain("Unverified: payment not confirmed");
    expect(page).toContain("Payment confirmed by merchant");
    expect(page).toContain("Price mismatch: do not fulfil");
    expect(page).toContain("Simulated: not a real order");
    expect(page).toMatch(/unverified:\['Unverified/);
  });
});
