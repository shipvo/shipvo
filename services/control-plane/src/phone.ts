// One phone per person: installed apps and a per-app key-value data area.
// Every query is keyed by the signed-in person's id, taken from the session and never from the request.
import { Hono } from "hono";
import { personId, sha256, type PeopleEnv } from "./people";

export type PhoneEnv = PeopleEnv & { PHONE_APP_DATA_MAX_BYTES?: string; PHONE_CONSENT_URL?: string };
export const CARD_TTL_MS = 15 * 60_000;
export const ASSISTANT_TOKEN_TTL_MS = 30 * 86400_000;
const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The person an assistant token (`Bearer sv_assistant_…`) belongs to, or null. It is not a person session: it cannot approve anything. */
export async function assistantPersonId(c: { req: { header(n: string): string | undefined }; env: PeopleEnv }): Promise<number | null> {
  const t = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!t.startsWith("sv_assistant_")) return null;
  const row = await c.env.DB.prepare("SELECT person_id, expires_at FROM phone_assistant_tokens WHERE token_hash = ?").bind(await sha256(t)).first<{ person_id: number; expires_at: string }>();
  return row && row.expires_at > new Date().toISOString() ? row.person_id : null;
}
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export const DEFAULT_APP_DATA_MAX_BYTES = 262144;
export const MAX_APPS = 200;
const MAX_VALUE_BYTES = 1048576;   // hard ceiling on one request body

const bytes = (s: string) => new TextEncoder().encode(s).length;
/** The per-app data cap, from configuration. */
export const appDataCap = (env: PhoneEnv) => { const n = Number(env.PHONE_APP_DATA_MAX_BYTES); return Number.isInteger(n) && n > 0 ? n : DEFAULT_APP_DATA_MAX_BYTES; };

export function phoneRoutes() {
  const r = new Hono<{ Bindings: PhoneEnv }>();
  const noStore = { "cache-control": "no-store" };

  r.get("/", async (c) => {
    const me = await personId(c as any); if (me === null) return c.json({ error: "unauthorized" }, 401);
    const { results } = await c.env.DB.prepare("SELECT app_id, installed_at FROM phone_apps WHERE person_id = ? ORDER BY app_id").bind(me).all<{ app_id: string; installed_at: string }>();
    return c.json({ apps: (results ?? []).map((a) => ({ id: a.app_id, installed_at: a.installed_at })) }, 200, noStore);
  });

  /** Replace the installed-apps list. Apps taken off the list lose their stored data. */
  r.put("/", async (c) => {
    const me = await personId(c as any); if (me === null) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null)) as { apps?: unknown } | null;
    const ids = body?.apps;
    if (!Array.isArray(ids) || ids.length > MAX_APPS || !ids.every((x) => typeof x === "string" && ID.test(x))) return c.json({ error: "bad_request", message: "apps must be a list of app ids" }, 400);
    const want = [...new Set(ids as string[])];
    const now = new Date().toISOString(), db = c.env.DB;
    const { results } = await db.prepare("SELECT app_id FROM phone_apps WHERE person_id = ?").bind(me).all<{ app_id: string }>();
    const have = new Set((results ?? []).map((a) => a.app_id));
    for (const id of have) if (!want.includes(id)) {
      await db.prepare("DELETE FROM phone_data WHERE person_id = ? AND app_id = ?").bind(me, id).run();
      await db.prepare("DELETE FROM phone_apps WHERE person_id = ? AND app_id = ?").bind(me, id).run();
    }
    for (const id of want) if (!have.has(id)) await db.prepare("INSERT OR IGNORE INTO phone_apps (person_id, app_id, installed_at) VALUES (?,?,?)").bind(me, id, now).run();
    await db.prepare("UPDATE phones SET updated_at = ? WHERE person_id = ?").bind(now, me).run();
    return c.json({ apps: want.sort().map((id) => ({ id })) }, 200, noStore);
  });

  const installed = (c: any, me: number, app: string) => c.env.DB.prepare("SELECT 1 FROM phone_apps WHERE person_id = ? AND app_id = ?").bind(me, app).first();

  r.get("/apps/:app/data/:key", async (c) => {
    const me = await personId(c as any); if (me === null) return c.json({ error: "unauthorized" }, 401);
    const { app, key } = c.req.param();
    if (!ID.test(app) || !KEY.test(key)) return c.json({ error: "not_found" }, 404);
    const row = await c.env.DB.prepare("SELECT value, updated_at FROM phone_data WHERE person_id = ? AND app_id = ? AND key = ?").bind(me, app, key).first<{ value: string; updated_at: string }>();
    return row ? c.json({ key, value: row.value, updated_at: row.updated_at }, 200, noStore) : c.json({ error: "not_found" }, 404);
  });

  /** Body: {"value": "<string>"}. The app's total (keys plus values) stays under the configured cap. */
  r.put("/apps/:app/data/:key", async (c) => {
    const me = await personId(c as any); if (me === null) return c.json({ error: "unauthorized" }, 401);
    const { app, key } = c.req.param();
    if (!ID.test(app) || !KEY.test(key) || !(await installed(c, me, app))) return c.json({ error: "not_found" }, 404);
    const raw = await c.req.text();
    if (bytes(raw) > MAX_VALUE_BYTES) return c.json({ error: "too_large" }, 413);
    let body: any; try { body = JSON.parse(raw); } catch { body = null; }
    if (!body || typeof body.value !== "string") return c.json({ error: "bad_request", message: 'body must be {"value": "<string>"}' }, 400);
    // The cap check and the write are not atomic: concurrent PUTs can overshoot the cap slightly. Fine for a storage guard.
    const cap = appDataCap(c.env);
    const used = (await c.env.DB.prepare("SELECT COALESCE(SUM(LENGTH(CAST(key AS BLOB)) + LENGTH(CAST(value AS BLOB))), 0) AS n FROM phone_data WHERE person_id = ? AND app_id = ? AND key != ?").bind(me, app, key).first<{ n: number }>())?.n ?? 0;
    if (used + bytes(key) + bytes(body.value) > cap) return c.json({ error: "app_data_full", cap_bytes: cap }, 413);
    await c.env.DB.prepare("INSERT INTO phone_data (person_id, app_id, key, value, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(person_id, app_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .bind(me, app, key, body.value, new Date().toISOString()).run();
    return c.json({ ok: true, key }, 200, noStore);
  });

  /** A person mints a token for their assistant. It can ask for installs and read the app list, never approve. */
  r.post("/assistant-tokens", async (c) => {
    const me = await personId(c as any); if (me === null) return c.json({ error: "unauthorized" }, 401);
    const token = `sv_assistant_${hex(24)}`, now = new Date();
    const expires_at = new Date(now.getTime() + ASSISTANT_TOKEN_TTL_MS).toISOString();
    await c.env.DB.prepare("INSERT INTO phone_assistant_tokens (token_hash, person_id, created_at, expires_at) VALUES (?,?,?,?)").bind(await sha256(token), me, now.toISOString(), expires_at).run();
    return c.json({ token, expires_at }, 200, noStore);
  });

  /** The assistant's view of the person's installed apps. */
  r.get("/assistant/apps", async (c) => {
    const me = await assistantPersonId(c as any); if (me === null) return c.json({ error: "unauthorized" }, 401);
    const { results } = await c.env.DB.prepare("SELECT app_id, installed_at FROM phone_apps WHERE person_id = ? ORDER BY app_id").bind(me).all<{ app_id: string; installed_at: string }>();
    return c.json({ apps: (results ?? []).map((a) => ({ id: a.app_id, installed_at: a.installed_at })) }, 200, noStore);
  });

  const cardView = (row: any, c: any) => {
    const base = (c.env.PHONE_CONSENT_URL ?? "https://shipvo.dev/phone/consent").replace(/\/$/, "");
    const link = (d: string) => `${base}${base.includes("?") ? "&" : "?"}card=${row.id}&decision=${d}`;
    return { id: row.id, status: row.status, app: { id: row.app_id, name: row.app_name }, publisher: row.publisher, permissions: JSON.parse(row.permissions), expires_at: row.expires_at, approve_url: link("approve"), decline_url: link("decline") };
  };
  /** A card past its time reads as expired, whatever is stored. */
  const effective = (row: any) => row.status === "pending" && row.expires_at <= new Date().toISOString() ? { ...row, status: "expired" } : row;

  /** The assistant asks to install an app. Returns the consent card; nothing is installed until the person approves. */
  r.post("/install-cards", async (c) => {
    const me = await assistantPersonId(c as any); if (me === null) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null)) as { app?: unknown } | null;
    if (typeof body?.app !== "string" || !ID.test(body.app)) return c.json({ error: "bad_request", message: "app must be an app id" }, 400);
    const a = await c.env.DB.prepare("SELECT apps.name AS name, accounts.github_login AS publisher FROM apps LEFT JOIN accounts ON accounts.id = apps.account_id WHERE apps.app_id = ?").bind(body.app).first<{ name: string; publisher: string | null }>();
    if (!a) return c.json({ error: "unknown_app" }, 404);
    if (await installed(c, me, body.app)) return c.json({ error: "already_installed" }, 409);
    // Permissions come from what the app declared, never from the caller.
    let permissions: unknown[] = [];
    try { const raw = await c.env.POINTERS?.get(`apps/${body.app}/permissions`); const p = raw ? JSON.parse(raw) : []; if (Array.isArray(p)) permissions = p; } catch { /* none declared */ }
    const now = new Date(), id = `card_${hex(16)}`;
    const row = { id, person_id: me, app_id: body.app, app_name: a.name, publisher: a.publisher ?? "unknown", permissions: JSON.stringify(permissions), status: "pending", expires_at: new Date(now.getTime() + CARD_TTL_MS).toISOString() };
    await c.env.DB.prepare("INSERT INTO phone_install_cards (id, person_id, app_id, app_name, publisher, permissions, status, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, me, row.app_id, row.app_name, row.publisher, row.permissions, "pending", now.toISOString(), row.expires_at).run();
    return c.json(cardView(row, c), 201, noStore);
  });

  /** The card, to the person (full card) or their assistant (same card, to see whether it was decided). */
  r.get("/install-cards/:id", async (c) => {
    const me = (await personId(c as any)) ?? (await assistantPersonId(c as any)); if (me === null) return c.json({ error: "unauthorized" }, 401);
    const row = await c.env.DB.prepare("SELECT * FROM phone_install_cards WHERE id = ? AND person_id = ?").bind(c.req.param("id"), me).first<any>();
    return row ? c.json(cardView(effective(row), c), 200, noStore) : c.json({ error: "not_found" }, 404);
  });

  /** Only a signed-in person (sv_person_ session) decides. An assistant token gets 401 here. */
  for (const verb of ["approve", "decline"] as const) r.post(`/install-cards/:id/${verb}`, async (c) => {
    const me = await personId(c as any); if (me === null) return c.json({ error: "unauthorized" }, 401);
    const id = c.req.param("id"), now = new Date().toISOString(), db = c.env.DB;
    // One conditional UPDATE decides the card, so a double click or a race cannot decide it twice.
    const won = await db.prepare("UPDATE phone_install_cards SET status = ?, decided_at = ? WHERE id = ? AND person_id = ? AND status = 'pending' AND expires_at > ?")
      .bind(verb === "approve" ? "approved" : "declined", now, id, me, now).run();
    const row = await db.prepare("SELECT * FROM phone_install_cards WHERE id = ? AND person_id = ?").bind(id, me).first<any>();
    if (!row) return c.json({ error: "not_found" }, 404);
    if (!(won as any).meta?.changes) return c.json({ error: row.status === "pending" ? "expired" : "already_decided", status: effective(row).status }, 409);
    if (verb === "approve") {
      await db.prepare("INSERT OR IGNORE INTO phones (person_id, created_at, updated_at) VALUES (?,?,?)").bind(me, now, now).run();
      await db.prepare("INSERT OR IGNORE INTO phone_apps (person_id, app_id, installed_at) VALUES (?,?,?)").bind(me, row.app_id, now).run();
      await db.prepare("UPDATE phones SET updated_at = ? WHERE person_id = ?").bind(now, me).run();
    }
    return c.json({ ok: true, status: verb === "approve" ? "approved" : "declined", app: row.app_id }, 200, noStore);
  });

  return r;
}
