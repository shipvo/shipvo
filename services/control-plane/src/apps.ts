// Hosted publishing: `shipvo app create` registers an app under a GitHub-signed-in account and returns a scoped publish token.
// `shipvo publish` then writes through /apps/:id/kv/* (the same keys it would write straight into Cloudflare KV), limited to
// that app's own key prefixes, with every release pointer verified against the app's registered public key. The private
// signing key never leaves the developer's machine or CI.
import { Hono } from "hono";
import { ReleasePointerBody } from "@shipvo/schema";

type Env = { POINTERS: KVNamespace; DB: D1Database; OWNER_TOKEN?: string };
export const apps = new Hono<{ Bindings: Env }>();

const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const RESERVED = new Set(["tide", "admin", "api", "app", "apps", "auth", "health", "band", "sim", "www", "shipvo", "purenative", "p", "b", "w", "c", "o", "t", "h"]);
const MAX_APPS_PER_ACCOUNT = 3;
const MAX_VALUE = 25 * 1024 * 1024;          // Workers KV value limit
const MAX_APP_BYTES = 500 * 1024 * 1024;     // storage budget per app
const TOKEN_TTL_DAYS = 90;
const PREFIXES = ["b", "w", "p", "h", "base"];
export const CATEGORIES = ["shop", "food", "travel", "finance", "health", "education", "services", "tools", "games", "other"];

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
  const tagline = String(b?.tagline ?? "").slice(0, 80), website = /^https?:\/\//.test(String(b?.website ?? "")) ? String(b.website).slice(0, 200) : "";
  const description = String(b?.description ?? "").slice(0, 1200), category = CATEGORIES.includes(String(b?.category)) ? String(b.category) : "other", listed = b?.listed ? 1 : 0;
  if (!ID.test(id)) return c.json({ error: "bad_app_id", message: "App ids are 2-40 characters: lowercase letters, digits and hyphens." }, 400);
  if (RESERVED.has(id)) return c.json({ error: "reserved_app_id", message: `"${id}" is reserved. Pick another id.` }, 409);
  try { if (unb64(pub).length !== 32) throw 0; } catch { return c.json({ error: "bad_public_key", message: "public_key must be the base64 Ed25519 public key (32 bytes) that shipvo init wrote to shipvo.json." }, 400); }
  const existing = await c.env.DB.prepare("SELECT account_id, public_key FROM apps WHERE app_id = ?").bind(id).first();
  if (existing) {
    if (existing.account_id !== dev.account_id) return c.json({ error: "app_id_taken", message: `"${id}" belongs to someone else. Pick another id.` }, 409);
    if (existing.public_key !== pub) return c.json({ error: "public_key_mismatch", message: "This app is registered with a different signing key. Installed shells pin the key, so it cannot change." }, 409);
    await c.env.DB.prepare("UPDATE apps SET name = ?, description = ?, category = ?, listed = ?, tagline = ?, website = ?, approved = CASE WHEN ? = 0 THEN 0 ELSE approved END WHERE app_id = ?").bind(name, description, category, listed, tagline, website, listed, id).run();
  } else {
    if ((await c.env.POINTERS.list({ prefix: `p/${id}/`, limit: 1 })).keys.length || (await c.env.POINTERS.list({ prefix: `w/${id}/`, limit: 1 })).keys.length)
      return c.json({ error: "app_id_taken", message: `"${id}" is already in use. Pick another id.` }, 409);
    const n = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM apps WHERE account_id = ?").bind(dev.account_id).first<{ n: number }>())!.n;
    if (n >= MAX_APPS_PER_ACCOUNT) return c.json({ error: "app_limit", message: `The beta allows ${MAX_APPS_PER_ACCOUNT} apps per account.` }, 403);
    await c.env.DB.prepare("INSERT INTO apps (app_id, account_id, name, public_key, description, category, listed, tagline, website) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, dev.account_id, name, pub, description, category, listed, tagline, website).run();
  }
  const t = await mintToken(c, id, dev.account_id, dev.login);
  return c.json({ app_id: id, created: !existing, publish_token: t.key, expires_at: t.expires_at, control_plane: new URL(c.req.url).origin,
    note: "Store the token as the SHIPVO_PUBLISH_TOKEN secret (CI) or in .shipvo/publish-token. It is not shown again; run shipvo app create again to get a new one." }, existing ? 200 : 201);
});

apps.get("/", async (c) => {
  const dev = await developer(c); if (!dev) return c.json({ error: "unauthorized" }, 401);
  const { results } = await c.env.DB.prepare("SELECT app_id, name, bytes_used, created_at, listed, approved, latest_release, category FROM apps WHERE account_id = ? ORDER BY created_at").bind(dev.account_id).all();
  return c.json({ login: dev.login, apps: results });
});

/** Delete an app: its files, its publish tokens and its registration. Owner only; the id becomes free again. */
apps.delete("/:id", async (c) => {
  const dev = await developer(c); if (!dev) return c.json({ error: "unauthorized" }, 401);
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT account_id FROM apps WHERE app_id = ?").bind(id).first<{ account_id: number }>();
  if (!row || row.account_id !== dev.account_id) return c.json({ error: "not_found" }, 404);
  let deleted = 0;
  for (const p of PREFIXES) {
    let cursor: string | undefined;
    do { const l = await c.env.POINTERS.list({ prefix: `${p}/${id}/`, cursor, limit: 1000 }); for (const k of l.keys) { await c.env.POINTERS.delete(k.name); deleted++; } cursor = l.list_complete ? undefined : l.cursor; } while (cursor);
  }
  await c.env.DB.prepare("UPDATE publish_tokens SET revoked_at = ? WHERE app_id = ? AND revoked_at IS NULL").bind(now(), id).run();
  await c.env.DB.prepare("DELETE FROM apps WHERE app_id = ?").bind(id).run();
  return c.json({ ok: true, app_id: id, files_deleted: deleted });
});

/** Store assets uploaded by `shipvo publish` (w/<id>/store/manifest.json + icon + screenshots). */
async function storeOf(kv: KVNamespace, id: string, origin: string, row?: any) {
  const out: any = { icon_url: null, screenshots: [], capabilities: [], release_note: null };
  try {
    const m = JSON.parse((await kv.get(`w/${id}/store/manifest.json`)) ?? "null");
    if (m) { const u = (n: string) => `${origin}/w/${id}/store/${n}`; Object.assign(out, { icon_url: m.icon ? u(m.icon) : null, screenshots: (m.screenshots ?? []).map(u), capabilities: m.capabilities ?? [], release_note: m.release_note ?? null, tagline: (row?.tagline || m.tagline || ""), website: (row?.website || m.website || "") }); }
  } catch {}
  // The release index in KV is the truth (apps may publish straight to KV); the DB column is a cache.
  try { const idx = JSON.parse((await kv.get(`w/${id}/releases`)) ?? "null"); if (idx && Number.isInteger(idx.latest)) { out.latest_release = idx.latest; out.releases = idx.releases?.length ?? null; if (row && row.latest_release !== idx.latest) { let at = row.published_at; try { at = JSON.parse((await kv.get(`h/${id}/r${idx.latest}`)) ?? "{}").issued_at ?? at; } catch {} out.published_at = at; } } } catch {}
  return out;
}
/** Called by the simulator service when an agent opens a public app: activity, not analytics. */
apps.post("/opened/:id", async (c) => {
  if (!c.env.OWNER_TOKEN || bearer(c) !== c.env.OWNER_TOKEN) return c.json({ error: "unauthorized" }, 401);
  await c.env.DB.prepare("UPDATE apps SET opens = opens + 1, last_opened_at = ? WHERE app_id = ?").bind(now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

/** The public directory: listed and approved apps with a published release. No auth. */
apps.get("/public", async (c) => {
  const q = (c.req.query("q") ?? "").toLowerCase().slice(0, 80), cat = c.req.query("category") ?? "";
  const { results } = await c.env.DB.prepare("SELECT a.app_id, a.name, a.tagline, a.description, a.category, a.website, a.latest_release, a.published_at, a.opens, a.last_opened_at, a.created_at, acc.github_login AS owner FROM apps a JOIN accounts acc ON acc.id = a.account_id WHERE a.listed = 1 AND a.approved = 1 AND a.latest_release IS NOT NULL ORDER BY a.opens DESC, a.published_at DESC LIMIT 200").all();
  const rows = (results as any[]).filter((r) => (!cat || r.category === cat) && (!q || `${r.app_id} ${r.name} ${r.tagline} ${r.description} ${r.category}`.toLowerCase().includes(q)));
  const origin = new URL(c.req.url).origin;
  const apps = await Promise.all(rows.map(async (r) => ({ ...r, ...(await storeOf(c.env.POINTERS, r.app_id, origin, r)) })));
  return c.json({ apps, categories: CATEGORIES }, 200, { "cache-control": "public, max-age=30", "access-control-allow-origin": "*" });
});
/** One public app. */
apps.get("/public/:id", async (c) => {
  const row: any = await c.env.DB.prepare("SELECT a.app_id, a.name, a.tagline, a.description, a.category, a.website, a.latest_release, a.published_at, a.opens, a.last_opened_at, a.created_at, acc.github_login AS owner FROM apps a JOIN accounts acc ON acc.id = a.account_id WHERE a.app_id = ? AND a.listed = 1 AND a.approved = 1").bind(c.req.param("id")).first();
  if (!row) return c.json({ error: "not_found" }, 404);
  const origin = new URL(c.req.url).origin;
  const store = await storeOf(c.env.POINTERS, row.app_id, origin, row);
  let releases: number[] = []; try { releases = JSON.parse((await c.env.POINTERS.get(`w/${row.app_id}/releases`)) ?? "{}").releases ?? []; } catch {}
  const history: { release: number; issued_at: string; size: number; min_shell_version?: string }[] = [];
  for (const r of releases.slice(-5).reverse()) { try { const h = JSON.parse((await c.env.POINTERS.get(`h/${row.app_id}/r${r}`)) ?? ""); history.push({ release: h.release, issued_at: h.issued_at, size: h.size, min_shell_version: h.min_shell_version }); } catch {} }
  const { results: similar } = await c.env.DB.prepare("SELECT a.app_id, a.name, a.tagline, a.category, a.opens FROM apps a WHERE a.listed = 1 AND a.approved = 1 AND a.latest_release IS NOT NULL AND a.app_id != ? ORDER BY (a.category = ?) DESC, a.opens DESC LIMIT 4").bind(row.app_id, row.category).all();
  const sim = await Promise.all((similar as any[]).map(async (s) => ({ ...s, ...(await storeOf(c.env.POINTERS, s.app_id, origin)) })));
  return c.json({ ...row, ...store, releases: releases.length || store.releases, history, similar: sim }, 200, { "access-control-allow-origin": "*", "cache-control": "public, max-age=30" });
});
/** Review queue and approval: owner token only. */
apps.get("/review", async (c) => {
  if (!c.env.OWNER_TOKEN || bearer(c) !== c.env.OWNER_TOKEN) return c.json({ error: "unauthorized" }, 401);
  const { results } = await c.env.DB.prepare("SELECT a.app_id, a.name, a.description, a.category, a.listed, a.approved, a.latest_release, acc.github_login AS owner FROM apps a JOIN accounts acc ON acc.id = a.account_id WHERE a.listed = 1 ORDER BY a.approved, a.created_at").all();
  return c.json({ apps: results });
});
apps.post("/review/:id", async (c) => {
  if (!c.env.OWNER_TOKEN || bearer(c) !== c.env.OWNER_TOKEN) return c.json({ error: "unauthorized" }, 401);
  let b: any; try { b = await c.req.json(); } catch { b = {}; }
  await c.env.DB.prepare("UPDATE apps SET approved = ? WHERE app_id = ?").bind(b?.approved ? 1 : 0, c.req.param("id")).run();
  return c.json({ ok: true, app_id: c.req.param("id"), approved: !!b?.approved });
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
  const shape = ReleasePointerBody.safeParse(body); if (!shape.success) return `pointer body is not a valid release pointer: ${shape.error.issues[0]?.path.join(".")} ${shape.error.issues[0]?.message}`;
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
  if (k === `w/${id}/releases`) { try { const idx = JSON.parse(new TextDecoder().decode(buf)); if (Number.isInteger(idx.latest)) await c.env.DB.prepare("UPDATE apps SET latest_release = ?, published_at = ? WHERE app_id = ?").bind(idx.latest, now(), id).run(); } catch {} }
  return c.json({ ok: true, key: k, bytes: buf.byteLength });
});
