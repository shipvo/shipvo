import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { Hono } from "hono";
import { vaultRoutes } from "../src/vault";
import { decryptSecret } from "../src/vault-crypto";
import app from "../src/index";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const MASTER = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const SECRET = "rk_live_SUPERSECRETVALUE1234567890";

function setup(fetchImpl?: any) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(require_sql());
  const db = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
  const who = async (c: any, appId: string) => (c.req.header("authorization") === `Bearer owner-${appId}` ? "owner (admin)" : null);
  const calls: string[] = [];
  const f = fetchImpl ?? (async (url: string) => { calls.push(url); return new Response("{}", { status: 200 }); });
  const h = new Hono(); h.route("/vault", vaultRoutes(who, { fetch: f }));
  const env = { DB: db, VAULT_MASTER_KEY: MASTER };
  const req = (path: string, init?: RequestInit, e: any = env) => h.request(path, init, e);
  const ticket = async (over: any = {}, as = "tide") => {
    const r = await req("/vault/tickets", { method: "POST", headers: { authorization: `Bearer owner-${as}` }, body: JSON.stringify({ app: "tide", name: "STRIPE_KEY", service: "stripe", purpose: "read orders", ...over }) });
    return { r, j: r.status === 201 ? await r.json() as any : null };
  };
  const store = (t: string, value = SECRET, extra: any = {}) => req(`/vault/t/${t}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value, ...extra }) });
  return { sql, req, ticket, store, calls, env };
}
function require_sql() {
  return createRequire(import.meta.url)("node:fs").readFileSync(new URL("../migrations/0021_vault.sql", import.meta.url), "utf8");
}

describe("vault tickets", () => {
  it("needs the app's owner", async () => {
    const { ticket } = setup();
    expect((await ticket({}, "other")).r.status).toBe(401);
  });
  it("rejects bad input and unknown service names", async () => {
    const { ticket } = setup();
    for (const o of [{ name: "bad name" }, { app: "../x" }, { access: "admin" }, { service: "not a host" }, { service: "localhost" }]) expect((await ticket(o)).r.status).toBe(400);
  });
  it("returns a ticket and url; the id is not stored", async () => {
    const { ticket, sql } = setup();
    const { j } = await ticket();
    expect(j.url).toBe(`http://localhost/vault/t/${j.ticket}`); expect(j.expires_in).toBe(600);
    expect(JSON.stringify(sql.prepare("SELECT * FROM vault_tickets").all())).not.toContain(j.ticket);
  });
  it("serves the form without using the ticket, and shows app, service, purpose and key advice", async () => {
    const { ticket, req, store } = setup();
    const { j } = await ticket({ purpose: "<b>x</b>" });
    for (let i = 0; i < 2; i++) {
      const r = await req(`/vault/t/${j.ticket}`); const html = await r.text();
      expect(r.status).toBe(200); expect(html).toContain("tide"); expect(html).toContain("api.stripe.com"); expect(html).toContain("restricted key"); expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    expect((await store(j.ticket)).status).toBe(201);
  });
});

describe("vault store", () => {
  it("is single-use", async () => {
    const { ticket, store, req } = setup();
    const { j } = await ticket();
    expect((await store(j.ticket)).status).toBe(201);
    expect((await store(j.ticket, "rk_other")).status).toBe(410);
    expect((await req(`/vault/t/${j.ticket}`)).status).toBe(410);
  });
  it("two racing posts store once", async () => {
    const { ticket, store } = setup();
    const { j } = await ticket();
    const s = (await Promise.all([store(j.ticket), store(j.ticket)])).map((r) => r.status).sort();
    expect(s).toEqual([201, 410]);
  });
  it("refuses an expired ticket", async () => {
    const { ticket, store, req } = setup();
    const { j } = await ticket();
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);
    try { expect((await store(j.ticket)).status).toBe(410); expect((await req(`/vault/t/${j.ticket}`)).status).toBe(410); } finally { vi.useRealTimers(); }
  });
  it("refuses a ticket bound to another app or name, and unknown tickets", async () => {
    const { ticket, store, sql } = setup();
    const { j } = await ticket();
    expect((await store(j.ticket, SECRET, { app: "other" })).status).toBe(400);
    expect((await store(j.ticket, SECRET, { name: "OTHER" })).status).toBe(400);
    expect((await store("vt_" + "A".repeat(43))).status).toBe(410);
    expect((await store("nonsense")).status).toBe(410);
    expect(sql.prepare("SELECT COUNT(*) n FROM vault_secrets").get().n).toBe(0);
    expect((await store(j.ticket)).status).toBe(201); // the failed tries did not spend it
  });
  it("another app's owner cannot get a ticket for this app", async () => {
    const { ticket } = setup();
    expect((await ticket({ app: "tide" }, "shop")).r.status).toBe(401);
  });
  it("refuses bad values and a missing master key", async () => {
    const { ticket, store, req, env } = setup();
    const { j } = await ticket();
    expect((await store(j.ticket, "")).status).toBe(400);
    expect((await store(j.ticket, "a b")).status).toBe(400);
    expect((await store(j.ticket, "x".repeat(5000))).status).toBe(413);
    const r = await req(`/vault/t/${j.ticket}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: SECRET }) }, { ...env, VAULT_MASTER_KEY: undefined });
    expect(r.status).toBe(503);
  });
  it("accepts the form post from the page", async () => {
    const { ticket, req, sql } = setup();
    const { j } = await ticket();
    const r = await req(`/vault/t/${j.ticket}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "value=" + SECRET });
    const html = await r.text();
    expect(r.status).toBe(201); expect(html).toContain("Saved"); expect(html).not.toContain(SECRET);
    expect(sql.prepare("SELECT COUNT(*) n FROM vault_secrets").get().n).toBe(1);
  });
});

describe("vault verification", () => {
  it("restricted key: valid, read, no warning; calls only the fixed Stripe URL", async () => {
    const { ticket, store, calls } = setup();
    const j = (await ticket()).j;
    const b: any = await (await store(j.ticket)).json();
    expect(b).toEqual({ saved: true, app: "tide", name: "STRIPE_KEY", valid: true, access: "read" });
    expect(calls).toEqual(["https://api.stripe.com/v1/balance"]);
  });
  it("full access key: stored with a warning flag", async () => {
    const { ticket, store, sql } = setup();
    const b: any = await (await store((await ticket()).j.ticket, "sk_live_FULLACCESS123")).json();
    expect(b.access).toBe("write"); expect(b.warning).toContain("full_access_key");
    expect(sql.prepare("SELECT warning, access FROM vault_secrets").get().warning).toContain("full_access_key");
  });
  it("a refused key is stored as not valid; an unreachable service as unchecked", async () => {
    let s = setup(async () => new Response("no", { status: 401 }));
    expect(((await (await s.store((await s.ticket()).j.ticket)).json()) as any).valid).toBe(false);
    expect(s.sql.prepare("SELECT valid FROM vault_secrets").get().valid).toBe(0);
    s = setup(async () => { throw new Error("down"); });
    expect(((await (await s.store((await s.ticket()).j.ticket)).json()) as any).valid).toBeNull();
  });
  it("an unknown service domain is stored unchecked and makes no call", async () => {
    const s = setup();
    const b: any = await (await s.store((await s.ticket({ service: "api.example.com", access: "write" })).j.ticket, "tok_abc")).json();
    expect(b.valid).toBeNull(); expect(b.access).toBe("write"); expect(s.calls).toEqual([]);
  });
});

describe("vault page copy and recovery", () => {
  const form = (req: any, t: string, value: string) => req(`/vault/t/${t}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "value=" + encodeURIComponent(value) });
  it("shows plain English, not error codes, on the HTML pages", async () => {
    const { ticket, req, env } = setup();
    const { j } = await ticket();
    const bad = await (await form(req, j.ticket, "a b")).text();
    expect(bad).toContain("must not contain spaces or line breaks"); expect(bad).not.toContain("bad_value");
    const nope = await (await form(req, "vt_" + "A".repeat(43), "x")).text();
    expect(nope).toContain("Ask the assistant for a new one"); expect(nope).not.toContain("ticket_not_valid");
    const nokey = await (await req(`/vault/t/${j.ticket}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "value=" + SECRET }, { ...env, VAULT_MASTER_KEY: undefined })).text();
    expect(nokey).not.toContain("vault_not_configured");
  });
  it("shows the full-access warning as a sentence, and says when a key could not be checked", async () => {
    const s = setup(async () => new Response("x", { status: 503 }));
    const html = await (await form(s.req, (await s.ticket()).j.ticket, "sk_live_FULLACCESS123")).text();
    expect(html).toContain("can change data and move money"); expect(html).not.toContain("full_access_key");
    expect(html).toContain("could not check this key");
  });
  it("the form has dark mode, focus and phone-keyboard hints", async () => {
    const { ticket, req } = setup();
    const html = await (await req(`/vault/t/${(await ticket()).j.ticket}`)).text();
    expect(html).toContain("color-scheme:light dark"); expect(html).toContain(":focus-visible"); expect(html).toContain('autocapitalize="off"');
  });
  it("a failed save gives the ticket back", async () => {
    const { ticket, req, env, sql } = setup();
    const { j } = await ticket();
    const real = env.DB;
    const flaky = { prepare: (q: string) => (q.startsWith("INSERT INTO vault_secrets") ? { bind: () => ({ run: async () => { throw new Error("d1 down"); } }) } : real.prepare(q)) };
    const r = await form((p: string, i: any) => req(p, i, { ...env, DB: flaky }), j.ticket, SECRET);
    expect(r.status).toBe(500); expect(await r.text()).toContain("not saved");
    expect(sql.prepare("SELECT used_at FROM vault_tickets").get().used_at).toBeNull();
    expect((await form(req, j.ticket, SECRET)).status).toBe(201);
    expect(sql.prepare("SELECT COUNT(*) n FROM vault_secrets").get().n).toBe(1);
  });
});

describe("vault at rest and in responses", () => {
  it("the D1 row holds no plaintext, and the value is never in any response or log", async () => {
    const logs: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: any[]) => { logs.push(a.join(" ")); }));
    try {
      const { ticket, store, req, sql } = setup();
      const { j } = await ticket();
      const seen = [JSON.stringify(j)];
      const form = await req(`/vault/t/${j.ticket}`); seen.push(await form.text());
      const ok = await store(j.ticket); seen.push(await ok.text());
      seen.push(await (await store(j.ticket)).text());
      seen.push(await (await req(`/vault/t/${j.ticket}`)).text());
      for (const p of ["/vault/secrets", "/vault/secrets/STRIPE_KEY", "/vault/tickets"]) { const r = await req(p, { headers: { authorization: "Bearer owner-tide" } }); seen.push(await r.text()); }
      for (const s of seen) expect(s).not.toContain(SECRET);
      expect(logs.join("\n")).not.toContain(SECRET);
      const dump = JSON.stringify([sql.prepare("SELECT * FROM vault_secrets").all(), sql.prepare("SELECT * FROM vault_tickets").all()]);
      expect(dump).not.toContain(SECRET); expect(dump).not.toContain("SUPERSECRET");
      expect(dump).not.toContain(btoa(SECRET));
    } finally { spies.forEach((s) => s.mockRestore()); }
  });
  it("round-trips with the master key, and fails on tampering or the wrong row", async () => {
    const { ticket, store, sql } = setup();
    await store((await ticket()).j.ticket);
    const row = sql.prepare("SELECT * FROM vault_secrets").get();
    const id = { app: row.app_id, name: row.name, domain: row.domain };
    const sealed = { wrapped_key: row.wrapped_key, ciphertext: row.ciphertext };
    expect(await decryptSecret(MASTER, id, sealed)).toBe(SECRET);
    const flip = (s: string) => { const u = Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); u[u.length - 1] ^= 1; return btoa(String.fromCharCode(...u)); };
    await expect(decryptSecret(MASTER, id, { ...sealed, ciphertext: flip(sealed.ciphertext) })).rejects.toThrow();
    await expect(decryptSecret(MASTER, id, { ...sealed, wrapped_key: flip(sealed.wrapped_key) })).rejects.toThrow();
    await expect(decryptSecret(MASTER, { ...id, domain: "evil.example.com" }, sealed)).rejects.toThrow();
    await expect(decryptSecret(MASTER, { ...id, app: "other" }, sealed)).rejects.toThrow();
    await expect(decryptSecret(btoa(String.fromCharCode(...new Uint8Array(32).fill(8))), id, sealed)).rejects.toThrow();
  });
  it("each secret has its own data key and nonce", async () => {
    const { ticket, store, sql } = setup();
    await store((await ticket()).j.ticket);
    await store((await ticket({ name: "OTHER_KEY" })).j.ticket);
    const rows = sql.prepare("SELECT wrapped_key, ciphertext FROM vault_secrets").all();
    expect(rows[0].wrapped_key).not.toBe(rows[1].wrapped_key); expect(rows[0].ciphertext).not.toBe(rows[1].ciphertext);
  });
  it("is mounted on the real worker", async () => {
    const r = await app.request("/vault/tickets", { method: "POST", body: JSON.stringify({ app: "tide", name: "K", service: "stripe" }) }, { DB: {} } as any);
    expect(r.status).toBe(401);
  });
});

describe("vault status and plain errors", () => {
  it("status says saved, valid and access, never the value, and needs the owner", async () => {
    const { ticket, store, req } = setup();
    const get = (as = "tide") => req("/vault/status/tide/STRIPE_KEY", { headers: { authorization: `Bearer owner-${as}` } });
    expect(await (await get()).json()).toEqual({ saved: false, valid: null, access: null });
    expect((await get("other")).status).toBe(401);
    await store((await ticket()).j.ticket);
    const r = await get();
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ saved: true, valid: true, access: "read" });
    expect(text).not.toContain(SECRET);
  });
  it("a reused ticket gets a plain error that says how to ask again", async () => {
    const { ticket, store } = setup();
    const t = (await ticket()).j.ticket;
    await store(t);
    const r = await store(t);
    expect(r.status).toBe(410);
    expect(((await r.json()) as any).message).toContain("Ask the assistant for a new one");
  });
});
