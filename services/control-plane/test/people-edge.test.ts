import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { Hono } from "hono";
import { peopleRoutes, sha256 } from "../src/people";

const req_ = createRequire(import.meta.url);
const { DatabaseSync } = req_("node:sqlite");

function setup(env: Record<string, unknown> = {}) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(req_("node:fs").readFileSync(new URL("../migrations/0022_people_phone.sql", import.meta.url), "utf8"));
  const db = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
  const mails: { to: string; text: string }[] = [];
  const h = new Hono(); h.route("/people", peopleRoutes(async (_e, m) => { mails.push(m); }));
  const post = (path: string, body: unknown, raw = false) =>
    h.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }, { DB: db, ...env });
  return { sql, post, mails };
}

describe("people sign-in edge cases", () => {
  it("an expired login token is refused and creates no person or session", async () => {
    const { sql, post, mails } = setup();
    await post("/people/login", { email: "a@b.dev" });
    const t = mails[0].text.match(/sv_login_[0-9a-f]+/)![0];
    sql.exec("UPDATE people_login_tokens SET expires_at = '2000-01-01T00:00:00.000Z'");
    expect((await post("/people/verify", { token: t })).status).toBe(410);
    expect(sql.prepare("SELECT COUNT(*) n FROM people").get().n).toBe(0);
    expect(sql.prepare("SELECT COUNT(*) n FROM people_sessions").get().n).toBe(0);
  });
  it("verify rejects missing, non-string, wrong-prefix and unparseable tokens with 400", async () => {
    const { post } = setup();
    for (const body of [{}, { token: 5 }, { token: "sv_person_abc" }, { token: "" }]) expect((await post("/people/verify", body)).status).toBe(400);
    expect((await post("/people/verify", "not json", true)).status).toBe(400);
  });
  it("verify with an unknown login token is 410", async () => {
    const { post } = setup();
    expect((await post("/people/verify", { token: "sv_login_" + "0".repeat(48) })).status).toBe(410);
  });
  it("login lowercases and trims the email, and rejects a non-string email", async () => {
    const { post, mails, sql } = setup();
    expect((await post("/people/login", { email: "  A@B.Dev " })).status).toBe(202);
    expect(mails[0].to).toBe("a@b.dev");
    expect(sql.prepare("SELECT email FROM people_login_tokens").get().email).toBe("a@b.dev");
    expect((await post("/people/login", { email: 42 })).status).toBe(400);
    expect((await post("/people/login", "{", true)).status).toBe(400);
  });
  it("the mailed link uses PEOPLE_LOGIN_URL with ? or & as needed, and stores only its hash", async () => {
    for (const [base, sep] of [["https://app.example/in", "?"], ["https://app.example/in?x=1", "&"]] as const) {
      const { post, mails, sql } = setup({ PEOPLE_LOGIN_URL: base });
      await post("/people/login", { email: "a@b.dev" });
      const m = mails[0].text.match(/(https:\/\/\S+)\n/)![1];
      expect(m.startsWith(`${base}${sep}token=sv_login_`)).toBe(true);
      const t = m.split("token=")[1];
      expect(sql.prepare("SELECT token_hash h FROM people_login_tokens").get().h).toBe(await sha256(t));
    }
  });
  it("without PEOPLE_LOGIN_URL the mail carries the bare token", async () => {
    const { post, mails } = setup();
    await post("/people/login", { email: "a@b.dev" });
    expect(mails[0].text).toMatch(/\nsv_login_[0-9a-f]{48}\n/);
  });
  it("login and verify answers are never cached", async () => {
    const { post, mails } = setup();
    expect((await post("/people/login", { email: "a@b.dev" })).headers.get("cache-control")).toBe("no-store");
    const t = mails[0].text.match(/sv_login_[0-9a-f]+/)![0];
    expect((await post("/people/verify", { token: t })).headers.get("cache-control")).toBe("no-store");
  });
});
