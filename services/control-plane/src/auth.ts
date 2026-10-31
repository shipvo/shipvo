// Self-serve access: GitHub device flow → account → API keys for the hosted simulator (sv_test_… keys).
// No client secret is needed for the device flow; GITHUB_CLIENT_ID is a plain var on the Worker.
import { Hono } from "hono";

type Env = { DB: D1Database; GITHUB_CLIENT_ID?: string; SIM_URL?: string };
export const auth = new Hono<{ Bindings: Env }>();
const BETA_APPS = ["tide"];   // apps anyone may open in the hosted simulator during the beta
const KEY_TTL_DAYS = 30;
const DEFAULT_QUOTA_MIN = 600;

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
function newKey(scope: string) {
  const rand = crypto.getRandomValues(new Uint8Array(24)); const body = btoa(String.fromCharCode(...rand)).replace(/[+/=]/g, (c) => ({ "+": "a", "/": "b", "=": "" }[c]!));
  const key = `sv_${scope}_${body}`; return { key, prefix: key.slice(0, 12) };
}
const gh = (path: string, init: RequestInit) => fetch(`https://github.com${path}`, { ...init, headers: { accept: "application/json", "content-type": "application/json", "user-agent": "shipvo-control", ...(init.headers ?? {}) } });

/** Step 1: the CLI asks for a device code and shows the person the URL + code. */
auth.post("/device/start", async (c) => {
  if (!c.env.GITHUB_CLIENT_ID) return c.json({ error: "login_not_configured", message: "GITHUB_CLIENT_ID is not set on this control plane" }, 503);
  const r = await gh("/login/device/code", { method: "POST", body: JSON.stringify({ client_id: c.env.GITHUB_CLIENT_ID, scope: "read:user" }) });
  const d: any = await r.json();
  if (!d.device_code) return c.json({ error: "github", detail: d }, 502);
  await c.env.DB.prepare("INSERT OR REPLACE INTO device_logins (device_code) VALUES (?)").bind(d.device_code).run();
  return c.json({ device_code: d.device_code, user_code: d.user_code, verification_uri: d.verification_uri, interval: d.interval ?? 5, expires_in: d.expires_in ?? 900 });
});

/** Step 2: the CLI polls; when GitHub says yes we create the account and the first key. */
auth.post("/device/poll", async (c) => {
  const { device_code } = (await c.req.json().catch(() => ({}))) as { device_code?: string };
  if (!device_code || !(await c.env.DB.prepare("SELECT 1 FROM device_logins WHERE device_code = ?").bind(device_code).first())) return c.json({ error: "unknown_device_code" }, 400);
  const r = await gh("/login/oauth/access_token", { method: "POST", body: JSON.stringify({ client_id: c.env.GITHUB_CLIENT_ID, device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }) });
  const d: any = await r.json();
  if (d.error) return c.json({ pending: true, status: d.error }, d.error === "authorization_pending" || d.error === "slow_down" ? 202 : 400);
  const u: any = await (await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${d.access_token}`, "user-agent": "shipvo-control", accept: "application/json" } })).json();
  if (!u?.id) return c.json({ error: "github_user" }, 502);
  await c.env.DB.prepare("INSERT INTO accounts (github_id, github_login, last_login_at) VALUES (?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(github_id) DO UPDATE SET github_login = excluded.github_login, last_login_at = excluded.last_login_at").bind(u.id, u.login).run();
  const acct = (await c.env.DB.prepare("SELECT id FROM accounts WHERE github_id = ?").bind(u.id).first<{ id: number }>())!;
  await c.env.DB.prepare("DELETE FROM device_logins WHERE device_code = ?").bind(device_code).run();
  // One test key per login, for every beta app (keys are per app today; the simulator reads app_id from the key).
  const { key, prefix } = newKey("test");
  // A new login replaces the account's earlier login keys, and the new key expires.
  await c.env.DB.prepare("UPDATE api_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE account_id = ? AND scope = 'test' AND revoked_at IS NULL").bind(acct.id).run();
  const expires_at = new Date(Date.now() + KEY_TTL_DAYS * 86400_000).toISOString();
  await c.env.DB.prepare("INSERT INTO api_keys (app_id, key_hash, prefix, scope, label, account_id, quota_minutes, expires_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(BETA_APPS[0], await sha256(key), prefix, "test", `shipvo login (${u.login})`, acct.id, DEFAULT_QUOTA_MIN, expires_at).run();
  const simUrl = (c.env.SIM_URL ?? "https://shipvo-sim.purenative.workers.dev").replace(/\/$/, "");
  return c.json({ login: u.login, key, prefix, scope: "test", apps: BETA_APPS, quota_minutes: DEFAULT_QUOTA_MIN, expires_at,
    mcp: { url: `${simUrl}/mcp`, header: `Authorization: Bearer ${key}`, url_with_key: `${simUrl}/mcp/${key}` },
    note: `Store the key now; it is not shown again. It expires in ${KEY_TTL_DAYS} days; run shipvo login again to renew. It opens the beta apps in the hosted simulator; quota is sandbox minutes.` });
});

/** A key's own status (the CLI's `shipvo keys`). */
auth.get("/me", async (c) => {
  const k = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!k) return c.json({ error: "unauthorized" }, 401);
  const row = await c.env.DB.prepare("SELECT k.prefix, k.scope, k.app_id, k.label, k.quota_minutes, k.used_minutes, k.created_at, k.last_used_at, k.expires_at, a.github_login FROM api_keys k LEFT JOIN accounts a ON a.id = k.account_id WHERE k.key_hash = ? AND k.revoked_at IS NULL").bind(await sha256(k)).first();
  if (!row) return c.json({ error: "unauthorized" }, 401);
  if ((row as any).expires_at && (row as any).expires_at < new Date().toISOString()) return c.json({ error: "key_expired", expires_at: (row as any).expires_at, hint: "Run shipvo login to get a new key." }, 401);
  return c.json(row);
});
