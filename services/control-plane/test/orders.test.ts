import { describe, it, expect } from "vitest";
import app from "../src/index";

function fake() {
  const rows: any[] = [];
  const DB = { prepare: (sql: string) => ({ bind: (...a: any[]) => ({
    run: async () => {
      const [app_id, order_id, total, json, status, idem] = a;
      if (rows.some((r) => r.app_id === app_id && r.idem === idem)) return { meta: { changes: 0 } };
      rows.push({ app_id, order_id, total, json, status, idem }); return { meta: { changes: 1 } };
    },
    first: async () => rows.find((r) => r.app_id === a[0] && r.idem === a[1]) ?? null,
  }) }) } as any;
  const m: Record<string, string> = {};
  const POINTERS = { get: async (k: string) => m[k] ?? null, put: async (k: string, v: string) => { m[k] = v; } } as any;
  return { rows, env: { DB, POINTERS } as any };
}
const send = (env: any, body: unknown, headers: Record<string, string> = {}) =>
  app.request("/o/tide", { method: "POST", body: JSON.stringify(body), headers }, env);
const order = { id: "TT-1", lines: [{ sku: "a", quantity: 1 }], total: 100 };

describe("orders", () => {
  it("stores new orders as unverified and simulated ones as simulated", async () => {
    const { rows, env } = fake();
    expect(await (await send(env, { order, install_id: "a" })).json()).toMatchObject({ status: "unverified" });
    await send(env, { order: { ...order, id: "TT-2" }, install_id: "a", simulated: true });
    expect(rows.map((r) => r.status)).toEqual(["unverified", "simulated"]);
  });
  it("returns the first result for an identical retry and stores one row", async () => {
    const { rows, env } = fake();
    const a = await (await send(env, { order, install_id: "a" })).json() as any;
    const b = await (await send(env, { order, install_id: "a" })).json() as any;
    expect(rows).toHaveLength(1);
    expect(b).toMatchObject({ order_id: a.order_id, status: a.status, duplicate: true });
  });
  it("stores a separate order when the same id has different lines", async () => {
    const { rows, env } = fake();
    await send(env, { order, install_id: "a" });
    await send(env, { order: { ...order, lines: [] }, install_id: "a" });
    expect(rows).toHaveLength(2);
  });
  it("returns 429 over the per-install limit, and other installs are unaffected", async () => {
    const { env } = fake();
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await send(env, { order: { ...order, id: `o${i}` }, install_id: "a" })).status;
    expect(last).toBe(429);
    expect((await send(env, { order, install_id: "b" })).status).toBe(202);
  });
  it("limits per cf-connecting-ip and ignores x-forwarded-for", async () => {
    const { env } = fake();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await send(env, { order: { ...order, id: `o${i}` }, install_id: `i${i}` }, { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": `9.9.9.${i}` })).status;
    expect(last).toBe(429);
    expect((await send(env, { order }, { "cf-connecting-ip": "2.2.2.2" })).status).toBe(202);
  });
});
