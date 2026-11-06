import { describe, it, expect } from "vitest";
import app from "../src/index";

const content = {
  products: [{ id: "a", price: 100, department: "d1" }, { id: "b", price: 50, department: "d2" }],
  promos: [{ code: "TEN", percent: 10, min_subtotal: 0, active: true, departments: ["d1"] }],
  slots: [{ id: "s1", fee: 20 }],
};
function fake() {
  const rows: any[] = [];
  const DB = { prepare: (sql: string) => ({ bind: (...a: any[]) => ({
    run: async () => {
      const [app_id, order_id, total, json, status, idem] = a;
      if (idem !== null && rows.some((r) => r.app_id === app_id && r.idem === idem)) return { meta: { changes: 0 } };
      rows.push({ app_id, order_id, total, json, status, idem }); return { meta: { changes: 1 } };
    },
    first: async () => /content_versions/.test(sql) ? (a[1] === 1 ? { json: JSON.stringify(content) } : null) : rows.find((r) => r.app_id === a[0] && r.idem === a[1]) ?? null,
  }) }) } as any;
  const m: Record<string, string> = {};
  const POINTERS = { get: async (k: string) => m[k] ?? null, put: async (k: string, v: string) => { m[k] = v; } } as any;
  return { rows, env: { DB, POINTERS } as any };
}
const send = (env: any, body: unknown, headers: Record<string, string> = {}) =>
  app.request("/o/tide", { method: "POST", body: JSON.stringify(body), headers }, env);
const order = { id: "TT-1", lines: [{ sku: "a", quantity: 1 }], total: 100 };
const ver = { content_version: 1 };

describe("orders", () => {
  it("stores new orders as unverified and simulated ones as simulated", async () => {
    const { rows, env } = fake();
    expect(await (await send(env, { order, ...ver, install_id: "a" })).json()).toMatchObject({ status: "unverified" });
    await send(env, { order: { ...order, id: "TT-2" }, ...ver, install_id: "a", simulated: true });
    expect(rows.map((r) => r.status)).toEqual(["unverified", "simulated"]);
  });
  it("returns the first result for an identical retry and stores one row", async () => {
    const { rows, env } = fake();
    const a = await (await send(env, { order, ...ver, install_id: "a" })).json() as any;
    const b = await (await send(env, { order, ...ver, install_id: "a" })).json() as any;
    expect(rows).toHaveLength(1);
    expect(b).toMatchObject({ order_id: a.order_id, status: a.status, duplicate: true });
  });
  it("stores a separate order when the same id has different lines", async () => {
    const { rows, env } = fake();
    await send(env, { order, ...ver, install_id: "a" });
    await send(env, { order: { ...order, lines: [] }, ...ver, install_id: "a" });
    expect(rows).toHaveLength(2);
  });
  it("returns 429 over the per-install limit, and other installs are unaffected", async () => {
    const { env } = fake();
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await send(env, { order: { ...order, id: `o${i}` }, ...ver, install_id: "a" })).status;
    expect(last).toBe(429);
    expect((await send(env, { order, ...ver, install_id: "b" })).status).toBe(202);
  });
  it("limits per cf-connecting-ip and ignores x-forwarded-for", async () => {
    const { env } = fake();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await send(env, { order: { ...order, id: `o${i}` }, ...ver, install_id: `i${i}` }, { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": `9.9.9.${i}` })).status;
    expect(last).toBe(429);
    expect((await send(env, { order, ...ver }, { "cf-connecting-ip": "2.2.2.2" })).status).toBe(202);
  });
  it("accepts a total with promo and delivery fee that matches the content", async () => {
    const { rows, env } = fake();
    const o = { id: "P1", lines: [{ product_id: "a", quantity: 2 }, { product_id: "b", quantity: 1 }], promo: "TEN", slot_id: "s1", total: 250 - 20 + 20 };
    expect((await send(env, { order: o, ...ver, install_id: "a" })).status).toBe(202);
    expect(rows[0].status).toBe("unverified");
  });
  it("rejects a tampered price, quantity or promo with 422 and stores price_mismatch", async () => {
    const { rows, env } = fake();
    for (const [i, o] of [{ ...order, total: 1 }, { ...order, lines: [{ sku: "a", quantity: 3 }] }, { ...order, promo: "TEN", total: 100 }, { ...order, lines: [{ sku: "a", quantity: 1, unit_price: 1 }] }].entries()) {
      const r = await send(env, { order: { ...o, id: `T${i}` }, ...ver, install_id: "a" });
      expect(r.status).toBe(422);
      expect(await r.json()).toMatchObject({ error: "price_mismatch", status: "price_mismatch" });
    }
    expect(rows.map((r) => r.status)).toEqual(Array(4).fill("price_mismatch"));
  });
  it("stores a correct retry with the same key after a mismatch", async () => {
    const { rows, env } = fake();
    expect((await send(env, { order: { ...order, total: 5 }, ...ver, install_id: "a" })).status).toBe(422);
    const r = await send(env, { order, ...ver, install_id: "a" });
    expect(r.status).toBe(202);
    expect(await r.json()).not.toHaveProperty("duplicate");
    expect(rows.map((x) => x.status)).toEqual(["price_mismatch", "unverified"]);
  });
  it("rejects an unknown release or missing catalogue with a typed reason", async () => {
    const { rows, env } = fake();
    for (const b of [{ content_version: 9 }, {}]) {
      const r = await send(env, { order, install_id: "a", ...b });
      expect(r.status).toBe(422);
      expect(await r.json()).toMatchObject({ reason: "unknown_release" });
    }
    content.products.splice(0, 2);
    try {
      const r = await send(env, { order, ...ver, install_id: "a" });
      expect(r.status).toBe(422);
      expect(await r.json()).toMatchObject({ reason: "missing_catalogue" });
    } finally { content.products.push({ id: "a", price: 100, department: "d1" }, { id: "b", price: 50, department: "d2" }); }
    expect(rows).toHaveLength(0);
  });
});
