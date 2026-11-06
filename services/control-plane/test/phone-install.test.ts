import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { Hono } from "hono";
import { peopleRoutes } from "../src/people";
import { phoneRoutes } from "../src/phone";

const req_ = createRequire(import.meta.url);
const { DatabaseSync } = req_("node:sqlite");
const mig = (f: string) => req_("node:fs").readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");

function setup() {
  const sql = new DatabaseSync(":memory:");
  for (const f of ["0006_accounts.sql", "0008_apps.sql", "0022_people_phone.sql", "0023_phone_install_cards.sql"]) {
    try { sql.exec(mig(f)); } catch { /* ALTERs on tables this test does not create */ }
  }
  sql.exec("CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, github_id INTEGER, github_login TEXT, created_at TEXT, last_login_at TEXT)");
  sql.exec("INSERT OR IGNORE INTO accounts (id, github_id, github_login) VALUES (1, 1, 'tidecraft')");
  sql.exec("INSERT OR IGNORE INTO apps (app_id, account_id, name, public_key) VALUES ('tide', 1, 'Tide Tables', 'k')");
  const db = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
  const POINTERS = { put: async () => {}, get: async (k: string) => (k === "apps/tide/permissions" ? JSON.stringify([{ name: "notifications", purpose: "Tell you when the tide turns" }]) : null) } as any;
  const mails: { text: string }[] = [];
  const h = new Hono();
  h.route("/people", peopleRoutes(async (_e, m) => { mails.push(m); }));
  h.route("/phone", phoneRoutes());
  const env = { DB: db, POINTERS };
  const call = (path: string, method = "GET", token?: string, body?: unknown) =>
    h.request(path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  const signIn = async (email: string) => {
    await call("/people/login", "POST", undefined, { email });
    const t = mails.at(-1)!.text.match(/sv_login_[0-9a-f]+/)![0];
    return ((await (await call("/people/verify", "POST", undefined, { token: t })).json()) as any).session as string;
  };
  const assistantFor = async (session: string) => ((await (await call("/phone/assistant-tokens", "POST", session)).json()) as any).token as string;
  const ask = async (assistant: string, app = "tide") => call("/phone/install-cards", "POST", assistant, { app });
  return { sql, call, signIn, assistantFor, ask };
}

describe("install_app consent card", () => {
  it("shows name, publisher, permissions and two links, and installs nothing yet", async () => {
    const { call, signIn, assistantFor, ask } = setup();
    const me = await signIn("a@x.dev"), bot = await assistantFor(me);
    const r = await ask(bot); expect(r.status).toBe(201);
    const card = (await r.json()) as any;
    expect(card).toMatchObject({ status: "pending", app: { id: "tide", name: "Tide Tables" }, publisher: "tidecraft", permissions: [{ name: "notifications" }] });
    expect(card.approve_url).toContain(`card=${card.id}`); expect(card.decline_url).toContain("decision=decline");
    expect(((await (await call("/phone/assistant/apps", "GET", bot)).json()) as any).apps).toEqual([]);
  });

  it("the model alone cannot approve: the assistant token and no token are refused", async () => {
    const { call, signIn, assistantFor, ask } = setup();
    const me = await signIn("a@x.dev"), bot = await assistantFor(me);
    const card = (await (await ask(bot)).json()) as any;
    expect((await call(`/phone/install-cards/${card.id}/approve`, "POST", bot)).status).toBe(401);
    expect((await call(`/phone/install-cards/${card.id}/approve`, "POST")).status).toBe(401);
    expect(((await (await call(`/phone/install-cards/${card.id}`, "GET", bot)).json()) as any).status).toBe("pending");
    expect(((await (await call("/phone/assistant/apps", "GET", bot)).json()) as any).apps).toEqual([]);
  });

  it("a person session cannot be used to ask, and another person cannot approve", async () => {
    const { call, signIn, assistantFor, ask } = setup();
    const me = await signIn("a@x.dev"), other = await signIn("b@x.dev"), bot = await assistantFor(me);
    expect((await call("/phone/install-cards", "POST", me, { app: "tide" })).status).toBe(401);
    const card = (await (await ask(bot)).json()) as any;
    expect((await call(`/phone/install-cards/${card.id}/approve`, "POST", other)).status).toBe(404);
  });

  it("approve by the person installs the app, once", async () => {
    const { call, signIn, assistantFor, ask } = setup();
    const me = await signIn("a@x.dev"), bot = await assistantFor(me);
    const card = (await (await ask(bot)).json()) as any;
    const ok = await call(`/phone/install-cards/${card.id}/approve`, "POST", me);
    expect(ok.status).toBe(200);
    expect(((await (await call("/phone", "GET", me)).json()) as any).apps.map((a: any) => a.id)).toEqual(["tide"]);
    expect((await call(`/phone/install-cards/${card.id}/decline`, "POST", me)).status).toBe(409);
    expect((await ask(bot)).status).toBe(409);
  });

  it("a declined card installs nothing and cannot be approved later", async () => {
    const { call, signIn, assistantFor, ask } = setup();
    const me = await signIn("a@x.dev"), bot = await assistantFor(me);
    const card = (await (await ask(bot)).json()) as any;
    expect((await call(`/phone/install-cards/${card.id}/decline`, "POST", me)).status).toBe(200);
    expect((await call(`/phone/install-cards/${card.id}/approve`, "POST", me)).status).toBe(409);
    expect(((await (await call("/phone", "GET", me)).json()) as any).apps).toEqual([]);
    expect(((await (await call(`/phone/install-cards/${card.id}`, "GET", bot)).json()) as any).status).toBe("declined");
  });

  it("an expired card installs nothing", async () => {
    const { call, sql, signIn, assistantFor, ask } = setup();
    const me = await signIn("a@x.dev"), bot = await assistantFor(me);
    const card = (await (await ask(bot)).json()) as any;
    sql.prepare("UPDATE phone_install_cards SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), card.id);
    const r = await call(`/phone/install-cards/${card.id}/approve`, "POST", me);
    expect(r.status).toBe(409); expect(((await r.json()) as any).error).toBe("expired");
    expect(((await (await call("/phone", "GET", me)).json()) as any).apps).toEqual([]);
    expect(((await (await call(`/phone/install-cards/${card.id}`, "GET", bot)).json()) as any).status).toBe("expired");
  });

  it("installed apps persist across chats and assistants", async () => {
    const { call, signIn, assistantFor, ask } = setup();
    const me = await signIn("a@x.dev"), bot1 = await assistantFor(me);
    const card = (await (await ask(bot1)).json()) as any;
    await call(`/phone/install-cards/${card.id}/approve`, "POST", me);
    const bot2 = await assistantFor(me), again = await signIn("a@x.dev");
    for (const t of [bot1, bot2]) expect(((await (await call("/phone/assistant/apps", "GET", t)).json()) as any).apps.map((a: any) => a.id)).toEqual(["tide"]);
    expect(((await (await call("/phone", "GET", again)).json()) as any).apps.map((a: any) => a.id)).toEqual(["tide"]);
    const stranger = await assistantFor(await signIn("b@x.dev"));
    expect(((await (await call("/phone/assistant/apps", "GET", stranger)).json()) as any).apps).toEqual([]);
  });

  it("refuses an unknown app", async () => {
    const { signIn, assistantFor, ask } = setup();
    const bot = await assistantFor(await signIn("a@x.dev"));
    expect((await ask(bot, "nope")).status).toBe(404);
  });
});
