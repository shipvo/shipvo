// Hosted publishing: `shipvo app create` registers an app under a GitHub-signed-in account and returns a scoped publish token.
// `shipvo publish` then writes through /apps/:id/kv/* (the same keys it would write straight into Cloudflare KV), limited to
// that app's own key prefixes, with every release pointer verified against the app's registered public key. The private
// signing key never leaves the developer's machine or CI.
import { Hono } from "hono";

type Env = { POINTERS: KVNamespace; DB: D1Database };
export const apps = new Hono<{ Bindings: Env }>();

const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const RESERVED = new Set(["tide", "admin", "api", "app", "apps", "auth", "health", "band", "sim", "www", "shipvo", "purenative", "p", "b", "w", "c", "o", "t", "h"]);
const MAX_APPS_PER_ACCOUNT = 3;
const MAX_VALUE = 25 * 1024 * 1024;          // Workers KV value limit
const MAX_APP_BYTES = 500 * 1024 * 1024;     // storage budget per app
const TOKEN_TTL_DAYS = 90;
const PREFIXES = ["b", "w", "p", "h", "base"];

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const bearer = (c: any) => (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
const now = () => new Date().toISOString();

/** A signed-in developer: a login key (scope test) that belongs to an account. */
async function developer(c: any): Promise<{ account_id: number; login: string } | null> {
  const k = bearer(c); if (!k) return null;
  const row = await c.env.DB.prepare("SELECT k.account_id, k.expires_at, a.github_login FROM api_keys k JOIN accounts a ON a.id = k.account_id WHERE k.key_hash = ? AND k.scope = 'test' AND k.revoked_at IS NULL").bind(await sha256(k)).first();
  if (!row || (row.expires_at && row.expires_at < now())) return null;
  return { account_id: row.account_id, login: row.github_login };
}

/** The publish token of one app. */
async function publisher(c: any, appId: string): Promise<{ public_key: string; bytes_used: number } | null> {
  const k = bearer(c); if (!k.startsWith("sv_publish_")) return null;
  const key = await c.env.DB.prepare("SELECT id, expires_at FROM publish_tokens WHERE key_hash = ? AND app_id = ? AND revoked_at IS NULL").bind(await sha256(k), appId).first();
  if (!key || (key.expires_at && key.expires_at < now())) return null;
  c.env.DB.prepare("UPDATE publish_tokens SET last_used_at = ? WHERE id = ?").bind(now(), key.id).run().catch(() => {});
  return (await c.env.DB.prepare("SELECT public_key, bytes_used FROM apps WHERE app_id = ?").bind(appId).first()) ?? null;
}

function newPublishToken() {
  const rand = crypto.getRandomValues(new Uint8Array(24)); const body = btoa(String.fromCharCode(...rand)).replace(/[+/=]/g, (ch) => ({ "+": "a", "/": "b", "=": "" }[ch]!));
  const key = `sv_publish_${body}`; return { key, prefix: key.slice(0, 14) };
}

async function mintToken(c: any, appId: string, accountId: number, login: string) {
  await c.env.DB.prepare("UPDATE publish_tokens SET revoked_at = ? WHERE app_id = ? AND revoked_at IS NULL").bind(now(), appId).run();
  const { key, prefix } = newPublishToken(); const expires_at = new Date(Date.now() + TOKEN_TTL_DAYS * 86400_000).toISOString();
  await c.env.DB.prepare("INSERT INTO publish_tokens (app_id, account_id, key_hash, prefix, label, expires_at) VALUES (?,?,?,?,?,?)")
    .bind(appId, accountId, await sha256(key), prefix, `shipvo publish (${login})`, expires_at).run();
  return { key, expires_at };
}

/** Register an app (or, for its owner with the same public key, mint a fresh publish token). */
apps.post("/", async (c) => {
  const dev = await developer(c); if (!dev) return c.json({ error: "unauthorized", hint: "Run shipvo login first." }, 401);
  let b: any; try { b = await c.req.json(); } catch { return c.json({ error: "bad_json" }, 400); }
  const id = String(b?.app_id ?? ""), name = String(b?.name ?? id).slice(0, 80), pub = String(b?.public_key ?? "");
  if (!ID.test(id)) return c.json({ error: "bad_app_id", message: "App ids are 2-40 characters: lowercase letters, digits and hyphens." }, 400);
  if (RESERVED.has(id)) return c.json({ error: "reserved_app_id", message: `"${id}" is reserved. Pick another id.` }, 409);
  try { if (unb64(pub).length !== 32) throw 0; } catch { return c.json({ error: "bad_public_key", message: "public_key must be the base64 Ed25519 public key (32 bytes) that shipvo init wrote to shipvo.json." }, 400); }
  const existing = await c.env.DB.prepare("SELECT account_id, public_key FROM apps WHERE app_id = ?").bind(id).first();
  if (existing) {
    if (existing.account_id !== dev.account_id) return c.json({ error: "app_id_taken", message: `"${id}" belongs to someone else. Pick another id.` }, 409);
    if (existing.public_key !== pub) return c.json({ error: "public_key_mismatch", message: "This app is registered with a different signing key. Installed shells pin the key, so it cannot change." }, 409);
  } else {
    if ((await c.env.POINTERS.list({ prefix: `p/${id}/`, limit: 1 })).keys.length || (await c.env.POINTERS.list({ prefix: `w/${id}/`, limit: 1 })).keys.length)
      return c.json({ error: "app_id_taken", message: `"${id}" is already in use. Pick another id.` }, 409);
    const n = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM apps WHERE account_id = ?").bind(dev.account_id).first<{ n: number }>())!.n;
    if (n >= MAX_APPS_PER_ACCOUNT) return c.json({ error: "app_limit", message: `The beta allows ${MAX_APPS_PER_ACCOUNT} apps per account.` }, 403);
    await c.env.DB.prepare("INSERT INTO apps (app_id, account_id, name, public_key) VALUES (?,?,?,?)").bind(id, dev.account_id, name, pub).run();
  }
  const t = await mintToken(c, id, dev.account_id, dev.login);
  return c.json({ app_id: id, created: !existing, publish_token: t.key, expires_at: t.expires_at, control_plane: new URL(c.req.url).origin,
    note: "Store the token as the SHIPVO_PUBLISH_TOKEN secret (CI) or in .shipvo/publish-token. It is not shown again; run shipvo app create again to get a new one." }, existing ? 200 : 201);
});

apps.get("/", async (c) => {
  const dev = await developer(c); if (!dev) return c.json({ error: "unauthorized" }, 401);
  const { results } = await c.env.DB.prepare("SELECT app_id, name, bytes_used, created_at FROM apps WHERE account_id = ? ORDER BY created_at").bind(dev.account_id).all();
  return c.json({ login: dev.login, apps: results });
});

const keyAllowed = (id: string, k: string) => k.length > 0 && k.length <= 300 && /^[A-Za-z0-9._\/-]+$/.test(k) && !k.includes("..") && PREFIXES.some((p) => k.startsWith(`${p}/${id}/`));
const keyOf = (c: any, id: string) => decodeURIComponent((c.req.path.split(`/${id}/kv/`)[1] ?? ""));

apps.get("/:id/kv", async (c) => {
  const id = c.req.param("id"); if (!(await publisher(c, id))) return c.json({ error: "unauthorized" }, 401);
  const prefix = c.req.query("prefix") ?? ""; if (!keyAllowed(id, prefix.endsWith("/") ? prefix + "x" : prefix)) return c.json({ error: "forbidden_prefix" }, 403);
  const l = await c.env.POINTERS.list({ prefix, limit: 1000 });
  return c.json({ keys: l.keys.map((k) => k.name) });
});
apps.get("/:id/kv/*", async (c) => {
  const id = c.req.param("id"); if (!(await publisher(c, id))) return c.json({ error: "unauthorized" }, 401);
  const k = keyOf(c, id); if (!keyAllowed(id, k)) return c.json({ error: "forbidden_key" }, 403);
  const v = await c.env.POINTERS.get(k, "arrayBuffer"); if (!v) return c.json({ error: "not_found" }, 404);
  return new Response(v, { headers: { "content-type": "application/octet-stream" } });
});

/** A release pointer must be signed with the app's registered key and name this app, shell major and band. */
async function pointerProblem(id: string, key: string, pub: string, buf: ArrayBuffer): Promise<string | null> {
  const [, , major, band] = key.split("/");
  let env: any, body: any;
  try { env = JSON.parse(new TextDecoder().decode(buf)); body = JSON.parse(env.body); } catch { return "a pointer is a JSON envelope { body, signature }"; }
  if (typeof env.signature !== "string") return "pointer has no signature";
  if (body.app_id !== id) return `pointer is for "${body.app_id}", not "${id}"`;
  if (String(body.shell_major) !== major || body.band !== band) return "pointer shell_major/band does not match its key";
  for (const alg of ["Ed25519", "NODE-ED25519"]) {
    try {
      const k = await crypto.subtle.importKey("raw", unb64(pub), { name: alg, namedCurve: "Ed25519" } as any, false, ["verify"]);
      return (await crypto.subtle.verify({ name: alg } as any, k, unb64(env.signature), new TextEncoder().encode(env.body))) ? null : "pointer signature does not verify against the app's registered public key";
    } catch { /* try the other algorithm name */ }
  }
  return "could not verify the pointer signature";
}

apps.put("/:id/kv/*", async (c) => {
  const id = c.req.param("id"); const app = await publisher(c, id); if (!app) return c.json({ error: "unauthorized" }, 401);
  const k = keyOf(c, id); if (!keyAllowed(id, k)) return c.json({ error: "forbidden_key", message: `Keys must start with one of ${PREFIXES.map((p) => `${p}/${id}/`).join(", ")}` }, 403);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > MAX_VALUE) return c.json({ error: "too_large" }, 413);
  if (app.bytes_used + buf.byteLength > MAX_APP_BYTES) return c.json({ error: "app_storage_exceeded", message: `This app has used its ${MAX_APP_BYTES / 1048576} MB beta storage.` }, 413);
  if (k.startsWith(`p/${id}/`)) { const why = await pointerProblem(id, k, app.public_key, buf); if (why) return c.json({ error: "bad_pointer", message: why }, 422); }
  await c.env.POINTERS.put(k, buf);
  await c.env.DB.prepare("UPDATE apps SET bytes_used = bytes_used + ? WHERE app_id = ?").bind(buf.byteLength, id).run();
  return c.json({ ok: true, key: k, bytes: buf.byteLength });
});
