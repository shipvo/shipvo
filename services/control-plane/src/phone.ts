// One phone per person: installed apps and a per-app key-value data area.
// Every query is keyed by the signed-in person's id, taken from the session and never from the request.
import { Hono } from "hono";
import { personId, type PeopleEnv } from "./people";

export type PhoneEnv = PeopleEnv & { PHONE_APP_DATA_MAX_BYTES?: string };
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
    if (raw.length > MAX_VALUE_BYTES) return c.json({ error: "too_large" }, 413);
    let body: any; try { body = JSON.parse(raw); } catch { body = null; }
    if (!body || typeof body.value !== "string") return c.json({ error: "bad_request", message: 'body must be {"value": "<string>"}' }, 400);
    const cap = appDataCap(c.env);
    const used = (await c.env.DB.prepare("SELECT COALESCE(SUM(LENGTH(CAST(key AS BLOB)) + LENGTH(CAST(value AS BLOB))), 0) AS n FROM phone_data WHERE person_id = ? AND app_id = ? AND key != ?").bind(me, app, key).first<{ n: number }>())?.n ?? 0;
    if (used + bytes(key) + bytes(body.value) > cap) return c.json({ error: "app_data_full", cap_bytes: cap }, 413);
    await c.env.DB.prepare("INSERT INTO phone_data (person_id, app_id, key, value, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(person_id, app_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .bind(me, app, key, body.value, new Date().toISOString()).run();
    return c.json({ ok: true, key }, 200, noStore);
  });

  return r;
}
