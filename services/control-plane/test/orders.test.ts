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
      if (sql.startsWith("SELECT status")) return rows.find((r) => r.app_id === a[0] && r.idem === a[1]) ?? null;
      if (sql.includes("COUNT(*)")) { const col = sql.includes("ip_hash") ? "ip_hash" : "install"; return { n: rows.filter((r) => r.app_id === a[0] && r[col] === a[1]).length }; }
      return null;
    },
    all: async () => ({ results: rows.filter((r) => r.app_id === a[0] && r.order_id === a[1] && (a.length < 3 || r[sql.includes("idem = ?") ? "idem" : "install"] === a[2])).map((r) => ({ id: r.id, status: r.status, total: r.total })) }),
    run: async () => {
      if (sql.startsWith("INSERT INTO orders")) { if (rows.some((r) => r.app_id === a[0] && r.idem === a[8])) return { meta: { changes: 0 } }; rows.push({ id: rows.length + 1, app_id: a[0], order_id: a[1], total: a[2], json: a[3], status: a[4], simulated: a[5], ip_hash: a[6], install: a[7], idem: a[8] }); }
      if (sql.startsWith("UPDATE orders")) { const r = rows.find((x) => x.id === a[2] && x.status === "unverified"); if (r) { r.status = "settled"; r.settled_at = a[0]; } }
      return { meta: { changes: 1 } };
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
  it("returns the first result for a reused idempotency_key with a different order and stores nothing new", async () => {
    const { env, rows } = fake();
    await place(env, good(), { idempotency_key: "k1" });
    const r = await place(env, { ...good(), total: 1 }, { idempotency_key: "k1" });
    expect(r.status).toBe(202);
    expect(((await r.json()) as any).duplicate).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(2000);
  });
  it("stores the same order id from two installs, both", async () => {
    const { env, rows } = fake();
    expect((await place(env, good("TT-1001"), { install_id: "a" })).status).toBe(202);
    const r = await place(env, good("TT-1001"), { install_id: "b" });
    expect(((await r.json()) as any).duplicate).toBe(false);
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.status === "unverified")).toBe(true);
  });
  it("stores two different orders with the same id from one IP with no install_id or key; an identical retry is a duplicate", async () => {
    const { env, rows } = fake();
    const h = { "cf-connecting-ip": "1.2.3.4" };
    const other = { ...good("TT-1001"), lines: [{ product_id: "line", quantity: 1, unit_price: 500 }], subtotal: 500, discount: 0, delivery_fee: 200, total: 700, promo: undefined };
    expect(((await (await place(env, good("TT-1001"), {}, h)).json()) as any).duplicate).toBe(false);
    expect(((await (await place(env, other, {}, h)).json()) as any).duplicate).toBe(false);
    expect(rows).toHaveLength(2);
    expect(((await (await place(env, good("TT-1001"), {}, h)).json()) as any).duplicate).toBe(true);
    expect(rows).toHaveLength(2);
  });
  it("stores two different orders with the same install_id and order id; an identical retry is a duplicate", async () => {
    const { env, rows } = fake();
    const other = { ...good("TT-1001"), lines: [{ product_id: "line", quantity: 1, unit_price: 500 }], subtotal: 500, discount: 0, delivery_fee: 200, total: 700, promo: undefined };
    expect(((await (await place(env, good("TT-1001"), { install_id: "a" })).json()) as any).duplicate).toBe(false);
    expect(((await (await place(env, other, { install_id: "a" })).json()) as any).duplicate).toBe(false);
    expect(rows).toHaveLength(2);
    expect(((await (await place(env, good("TT-1001"), { install_id: "a" })).json()) as any).duplicate).toBe(true);
    expect(rows).toHaveLength(2);
  });
  it("lets a retry with corrected content succeed after a price_mismatch under the same idempotency_key", async () => {
    const { env, rows } = fake();
    const r1 = await app.request("/o/tide", { method: "POST", body: JSON.stringify({ order: good("TT-9"), content_version: 99, idempotency_key: "k9" }) }, env);
    expect(r1.status).toBe(422);
    const r2 = await place(env, good("TT-9"), { idempotency_key: "k9" });
    expect(r2.status).toBe(202);
    const b = (await r2.json()) as any;
    expect(b.status).toBe("unverified");
    expect(b.duplicate).toBe(false);
    expect(rows.map((x) => x.status)).toEqual(["price_mismatch", "unverified"]);
  });
  it("accepts the exact payload Tide sends today (order, content_version, release) as unverified", async () => {
    const { env, rows } = fake();
    const r = await app.request("/o/tide", { method: "POST", body: JSON.stringify({ order: good("TT-1001"), content_version: 3, release: "1.0.0" }) }, env);
    expect(r.status).toBe(202);
    expect(((await r.json()) as any).status).toBe("unverified");
    expect(rows[0].status).toBe("unverified");
  });
  it("lets a client idempotency_key tell orders apart, and repeats of it are duplicates", async () => {
    const { env, rows } = fake();
    await place(env, good("TT-1001"), { idempotency_key: "u1" });
    await place(env, good("TT-1001"), { idempotency_key: "u2" });
    expect(((await (await place(env, good("TT-1001"), { idempotency_key: "u1" })).json()) as any).duplicate).toBe(true);
    expect(rows).toHaveLength(2);
  });
  it("a simulated or price_mismatch squatter does not block a real order from another install", async () => {
    const { env, rows } = fake();
    await place(env, good("TT-1001"), { install_id: "evil", simulated: true });
    await place(env, { ...good("TT-1001"), total: 1 }, { install_id: "evil2" });
    const r = await place(env, good("TT-1001"), { install_id: "real" });
    expect(r.status).toBe(202);
    expect(((await r.json()) as any).status).toBe("unverified");
    expect(rows.map((x) => x.status)).toEqual(["simulated", "price_mismatch", "unverified"]);
    expect((await settle(env, "TT-1001", "Bearer tok")).status).toBe(409); // ambiguous without a selector
    const ok = await app.request("/app/tide/api/orders/TT-1001/settle", { method: "POST", headers: { authorization: "Bearer tok" }, body: JSON.stringify({ install_id: "real" }) }, env);
    expect(ok.status).toBe(200);
    expect(rows[2].status).toBe("settled");
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
    expect(rows[0].settled_at).toBeUndefined();
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
  it("refuses to settle when the stated amount differs from the stored total", async () => {
    const { env, rows } = fake();
    await place(env, good());
    const r = await app.request("/app/tide/api/orders/TT-1/settle", { method: "POST", headers: { authorization: "Bearer tok" }, body: JSON.stringify({ amount: 5 }) }, env);
    expect(r.status).toBe(409);
    expect(rows[0].status).toBe("unverified");
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
