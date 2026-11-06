import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { Hono } from "hono";
import { peopleRoutes } from "../src/people";
import { phoneRoutes } from "../src/phone";

const req_ = createRequire(import.meta.url);
const { DatabaseSync } = req_("node:sqlite");

function setup(extra: any = {}) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(req_("node:fs").readFileSync(new URL("../migrations/0022_people_phone.sql", import.meta.url), "utf8"));
  const db = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
  const mails: { to: string; text: string }[] = [];
  const h = new Hono();
  h.route("/people", peopleRoutes(async (_e, m) => { mails.push(m); }));
  h.route("/phone", phoneRoutes());
  const env = { DB: db, ...extra };
  const call = (path: string, method = "GET", session?: string, body?: unknown) =>
    h.request(path, { method, headers: { ...(session ? { authorization: `Bearer ${session}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  const signIn = async (email: string) => {
    await call("/people/login", "POST", undefined, { email });
    const t = mails.at(-1)!.text.match(/sv_login_[0-9a-f]+/)![0];
    const r = await call("/people/verify", "POST", undefined, { token: t });
    return { t, r, session: r.status === 200 ? ((await r.json()) as any).session as string : "" };
  };
  return { sql, call, signIn, mails };
}

describe("people sign-in", () => {
  it("rejects a bad email and answers the same for any valid one", async () => {
    const { call } = setup();
    expect((await call("/people/login", "POST", undefined, { email: "nope" })).status).toBe(400);
    expect((await call("/people/login", "POST", undefined, { email: "a@b.dev" })).status).toBe(202);
  });
  it("login token works once", async () => {
    const { signIn, call } = setup();
    const { t } = await signIn("a@b.dev");
    expect((await call("/people/verify", "POST", undefined, { token: t })).status).toBe(410);
  });
  it("stores only hashes of tokens", async () => {
    const { signIn, sql } = setup();
    const { t, session } = await signIn("a@b.dev");
    const all = JSON.stringify([sql.prepare("SELECT * FROM people_login_tokens").all(), sql.prepare("SELECT * FROM people_sessions").all()]);
    expect(all).not.toContain(t); expect(all).not.toContain(session);
  });
  it("same email is the same person on a second sign-in", async () => {
    const { signIn, sql } = setup();
    await signIn("A@B.dev"); await signIn("a@b.dev");
    expect(sql.prepare("SELECT COUNT(*) n FROM people").get().n).toBe(1);
  });
  it("an expired session is refused", async () => {
    const { signIn, call, sql } = setup();
    const { session } = await signIn("a@b.dev");
    sql.exec("UPDATE people_sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
    expect((await call("/phone", "GET", session)).status).toBe(401);
  });
});

describe("phone", () => {
  it("needs sign-in on every route", async () => {
    const { call } = setup();
    for (const [m, p] of [["GET", "/phone"], ["PUT", "/phone"], ["GET", "/phone/apps/tide/data/k"], ["PUT", "/phone/apps/tide/data/k"]]) {
      expect((await call(p, m, undefined, m === "PUT" ? { apps: [] } : undefined)).status, `${m} ${p}`).toBe(401);
      expect((await call(p, m, "sv_person_bogus", m === "PUT" ? { apps: [] } : undefined)).status).toBe(401);
    }
  });
  it("installs, writes, and a second client reads the same data", async () => {
    const { signIn, call } = setup();
    const a = await signIn("a@b.dev");
    expect((await call("/phone", "PUT", a.session, { apps: ["tide"] })).status).toBe(200);
    expect((await call("/phone/apps/tide/data/note", "PUT", a.session, { value: "hello" })).status).toBe(200);
    const b = await signIn("a@b.dev");
    expect(b.session).not.toBe(a.session);
    expect(((await (await call("/phone", "GET", b.session)).json()) as any).apps.map((x: any) => x.id)).toEqual(["tide"]);
    expect(((await (await call("/phone/apps/tide/data/note", "GET", b.session)).json()) as any).value).toBe("hello");
  });
  it("another person gets 404 on every route and cannot change anything", async () => {
    const { signIn, call } = setup();
    const a = await signIn("a@b.dev"), o = await signIn("o@b.dev");
    await call("/phone", "PUT", a.session, { apps: ["tide"] });
    await call("/phone/apps/tide/data/note", "PUT", a.session, { value: "secret" });
    // Other person sees an empty phone.
    expect(((await (await call("/phone", "GET", o.session)).json()) as any).apps).toEqual([]);
    expect((await call("/phone/apps/tide/data/note", "GET", o.session)).status).toBe(404);
    expect((await call("/phone/apps/tide/data/note", "PUT", o.session, { value: "x" })).status).toBe(404);
    // Their PUT /phone only changes their own phone.
    await call("/phone", "PUT", o.session, { apps: [] });
    expect(((await (await call("/phone/apps/tide/data/note", "GET", a.session)).json()) as any).value).toBe("secret");
    // Installing the same app id themselves gives an empty data area, not A's.
    await call("/phone", "PUT", o.session, { apps: ["tide"] });
    expect((await call("/phone/apps/tide/data/note", "GET", o.session)).status).toBe(404);
  });
  it("data for an app that is not installed is 404; removing an app removes its data", async () => {
    const { signIn, call } = setup();
    const a = await signIn("a@b.dev");
    expect((await call("/phone/apps/tide/data/k", "PUT", a.session, { value: "v" })).status).toBe(404);
    await call("/phone", "PUT", a.session, { apps: ["tide"] });
    await call("/phone/apps/tide/data/k", "PUT", a.session, { value: "v" });
    await call("/phone", "PUT", a.session, { apps: [] });
    await call("/phone", "PUT", a.session, { apps: ["tide"] });
    expect((await call("/phone/apps/tide/data/k", "GET", a.session)).status).toBe(404);
  });
  it("validates ids, keys and bodies", async () => {
    const { signIn, call } = setup();
    const a = await signIn("a@b.dev");
    expect((await call("/phone", "PUT", a.session, { apps: ["../x"] })).status).toBe(400);
    expect((await call("/phone", "PUT", a.session, {})).status).toBe(400);
    await call("/phone", "PUT", a.session, { apps: ["tide"] });
    expect((await call("/phone/apps/tide/data/k", "PUT", a.session, { value: 5 })).status).toBe(400);
    expect((await call("/phone/apps/tide/data/bad%20key", "PUT", a.session, { value: "v" })).status).toBe(404);
  });
  it("caps per-app data by configuration, counting overwrites once", async () => {
    const { signIn, call } = setup({ PHONE_APP_DATA_MAX_BYTES: "20" });
    const a = await signIn("a@b.dev");
    await call("/phone", "PUT", a.session, { apps: ["tide", "other"] });
    expect((await call("/phone/apps/tide/data/k", "PUT", a.session, { value: "x".repeat(19) })).status).toBe(200);   // 1 + 19 = 20
    expect((await call("/phone/apps/tide/data/k", "PUT", a.session, { value: "y".repeat(19) })).status).toBe(200);   // overwrite fits
    const full = await call("/phone/apps/tide/data/j", "PUT", a.session, { value: "z" });
    expect(full.status).toBe(413); expect(((await full.json()) as any).cap_bytes).toBe(20);
    expect((await call("/phone/apps/other/data/k", "PUT", a.session, { value: "x".repeat(19) })).status).toBe(200);   // cap is per app
  });
});
