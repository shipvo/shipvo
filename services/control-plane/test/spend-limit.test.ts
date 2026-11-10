import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { Hono } from "hono";
import { peopleRoutes } from "../src/people";
import { phoneRoutes } from "../src/phone";
import { authorizeSpend } from "../src/spend";

const req_ = createRequire(import.meta.url);
const { DatabaseSync } = req_("node:sqlite");
const mig = (f: string) => req_("node:fs").readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");

async function setup() {
  const sql = new DatabaseSync(":memory:");
  for (const f of ["0022_people_phone.sql", "0023_phone_install_cards.sql", "0025_spend_limit.sql"]) sql.exec(mig(f));
  const db = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
  const mails: { text: string }[] = [];
  const h = new Hono();
  h.route("/people", peopleRoutes(async (_e, m) => { mails.push(m); }));
  h.route("/phone", phoneRoutes());
  const env = { DB: db };
  const call = (path: string, method = "GET", token?: string, body?: unknown) =>
    h.request(path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  await call("/people/login", "POST", undefined, { email: "a@x.dev" });
  const t = mails.at(-1)!.text.match(/sv_login_[0-9a-f]+/)![0];
  const session = ((await (await call("/people/verify", "POST", undefined, { token: t })).json()) as any).session as string;
  await call("/phone", "PUT", session, { apps: ["tide"] });
  const assistant = ((await (await call("/phone/assistant-tokens", "POST", session)).json()) as any).token as string;
  const me = sql.prepare("SELECT person_id FROM phone_apps").get().person_id as number;
  return { sql, env, call, session, assistant, me };
}
const pay = (me: number, amount: number) => ({ person: me, app: "tide", amount, currency: "USD", secret: "STRIPE_KEY" });

describe("per-app spend limit", () => {
  it("defaults to 0 and refuses a money action", async () => {
    const { env, me, call, session } = await setup();
    expect(((await (await call("/phone/apps/tide/spend-limit", "GET", session)).json()) as any).spend_limit.amount).toBe(0);
    expect(await authorizeSpend(env, pay(me, 100))).toEqual({ ok: false, code: "spend_limit", limit: 0, spent: 0 });
  });
  it("passes under the limit and refuses the call that would pass it", async () => {
    const { env, me, call, session, sql } = await setup();
    const put = await call("/phone/apps/tide/spend-limit", "PUT", session, { amount: 1000, currency: "USD", period: "month" });
    expect(put.status).toBe(200);
    expect(await authorizeSpend(env, pay(me, 600))).toEqual({ ok: true });
    expect(await authorizeSpend(env, pay(me, 400))).toEqual({ ok: true });
    expect(await authorizeSpend(env, pay(me, 1))).toEqual({ ok: false, code: "spend_limit", limit: 1000, spent: 1000 });
    const g: any = await (await call("/phone/apps/tide/spend-limit", "GET", session)).json();
    expect(g).toEqual({ spend_limit: { amount: 1000, currency: "USD", period: "month" }, spent: 1000 });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM phone_spend").get().n).toBe(2);
  });
  it("does not count last month and refuses another currency", async () => {
    const { env, me, call, session } = await setup();
    await call("/phone/apps/tide/spend-limit", "PUT", session, { amount: 500, currency: "USD" });
    expect(await authorizeSpend(env, pay(me, 500), new Date("2026-01-15"))).toEqual({ ok: true });
    expect(await authorizeSpend(env, pay(me, 500), new Date("2026-02-15"))).toEqual({ ok: true });
    expect((await authorizeSpend(env, { ...pay(me, 1), currency: "EUR" })).ok).toBe(false);
  });
  it("an assistant token gets 403, the person can set it, bad input is 400", async () => {
    const { call, session, assistant } = await setup();
    expect((await call("/phone/apps/tide/spend-limit", "PUT", assistant, { amount: 99999, currency: "USD" })).status).toBe(403);
    expect((await call("/phone/apps/tide/spend-limit", "GET", assistant)).status).toBe(403);
    expect((await call("/phone/apps/tide/spend-limit", "GET")).status).toBe(401);
    expect((await call("/phone/apps/tide/spend-limit", "PUT", session, { amount: -1, currency: "USD" })).status).toBe(400);
    expect((await call("/phone/apps/tide/spend-limit", "PUT", session, { amount: 5, currency: "USD" })).status).toBe(200);
  });
  it("writes audit rows for set and refuse", async () => {
    const { env, me, call, session, sql } = await setup();
    await call("/phone/apps/tide/spend-limit", "PUT", session, { amount: 100, currency: "USD" });
    await authorizeSpend(env, pay(me, 500));
    const rows = sql.prepare("SELECT action, detail FROM phone_spend_audit ORDER BY id").all();
    expect(rows.map((r: any) => r.action)).toEqual(["spend_limit_set", "spend_refused"]);
    expect(JSON.parse(rows[1].detail)).toMatchObject({ limit: 100, spent: 0, amount: 500 });
  });
  it("two calls at once cannot pass the limit together", async () => {
    const { env, me, call, session, sql } = await setup();
    await call("/phone/apps/tide/spend-limit", "PUT", session, { amount: 1000, currency: "USD" });
    const rs = await Promise.all([authorizeSpend(env, pay(me, 600)), authorizeSpend(env, pay(me, 600))]);
    expect(rs.filter((r) => r.ok).length).toBe(1);
    expect(sql.prepare("SELECT SUM(amount) AS s FROM phone_spend").get().s).toBe(600);
  });
  it("old-currency spend does not count against a new currency limit", async () => {
    const { env, me, call, session } = await setup();
    await call("/phone/apps/tide/spend-limit", "PUT", session, { amount: 500, currency: "USD" });
    expect(await authorizeSpend(env, pay(me, 500))).toEqual({ ok: true });
    await call("/phone/apps/tide/spend-limit", "PUT", session, { amount: 500, currency: "EUR" });
    expect(await authorizeSpend(env, { ...pay(me, 500), currency: "EUR" })).toEqual({ ok: true });
  });
  it("rejects period week with 400", async () => {
    const { call, session } = await setup();
    expect((await call("/phone/apps/tide/spend-limit", "PUT", session, { amount: 5, currency: "USD", period: "week" })).status).toBe(400);
  });
});
