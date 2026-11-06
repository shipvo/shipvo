// Key rotation courier (docs/design/key-rotation.md, sections 3, 6, 8 and 10).
// Stores root-signed statements and serves them. Phones verify again; this check only keeps junk out.
import { Hono } from "hono";
import * as ed from "@noble/ed25519";

type Env = { POINTERS: KVNamespace; DB: D1Database; ADMIN_PASSWORD?: string };
export type RotationEnvelope = { body: string; signature: string };

export const MAX_RESPONSE = 8;
export const MAX_BODY_BYTES = 1024;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const enc = new TextEncoder();
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
const keyOk = (s: unknown) => { try { return typeof s === "string" && unb64(s).length === 32; } catch { return false; } };

/** The rotation envelopes a phone should get: the 8 highest sequences, ascending. Never throws. */
export async function rotationsFor(db: any, appId: string): Promise<{ rotations: RotationEnvelope[]; top: number }> {
  try {
    const r = await db.prepare("SELECT sequence, body, signature FROM rotations WHERE app_id = ? ORDER BY sequence DESC LIMIT ?").bind(appId, MAX_RESPONSE).all();
    const rows = (Array.isArray(r?.results) ? r.results : []).filter((x: any) => typeof x?.body === "string" && typeof x?.signature === "string" && Number.isInteger(x.sequence));
    rows.sort((a: any, b: any) => a.sequence - b.sequence);
    return { rotations: rows.map((x: any) => ({ body: x.body, signature: x.signature })), top: rows.length ? rows[rows.length - 1].sequence : 0 };
  } catch (e) { console.error("rotationsFor failed", e); return { rotations: [], top: 0 }; }
}

/**
 * `adminSession(c, appId)` must accept only the signed admin cookie, never a bearer token.
 * A login key (sv_test_...) counts only when its account owns the app. Publish tokens and the owner token never do.
 */
export function rotationRoutes(adminSession: (c: any, appId: string) => Promise<string | null>) {
  const r = new Hono<{ Bindings: Env }>();

  async function session(c: any, appId: string): Promise<{ actor: string } | null> {
    const cookie = await adminSession(c, appId);
    if (cookie) return { actor: cookie };
    const k = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!k.startsWith("sv_test_")) return null;
    try {
      const row: any = await c.env.DB.prepare("SELECT k.account_id, k.expires_at, a.github_login FROM api_keys k JOIN accounts a ON a.id = k.account_id WHERE k.key_hash = ? AND k.scope = 'test' AND k.revoked_at IS NULL").bind(await sha256(k)).first();
      if (!row || (row.expires_at && row.expires_at < new Date().toISOString())) return null;
      const own: any = await c.env.DB.prepare("SELECT account_id FROM apps WHERE app_id = ?").bind(appId).first();
      return own && own.account_id === row.account_id ? { actor: String(row.github_login) } : null;
    } catch { return null; }
  }
  async function gate(c: any, appId: string) {
    if (!ID.test(appId)) return { res: c.json({ error: "bad_request" }, 400) };
    const s = await session(c, appId);
    if (s) return { s };
    // A token is known but not allowed: 403. No credentials at all: 401.
    return { res: (c.req.header("authorization") ?? "") ? c.json({ error: "forbidden", message: "Rotation needs a signed-in owner session. Tokens cannot rotate keys." }, 403) : c.json({ error: "unauthorized" }, 401) };
  }
  const bad = (c: any, error: string, message: string, status = 400) => c.json({ error, message }, status);

  r.put("/:app/root", async (c) => {
    const appId = c.req.param("app");
    const g: any = await gate(c, appId); if (g.res) return g.res;
    let b: any; try { b = await c.req.json(); } catch { return bad(c, "bad_json", "body must be JSON like {\"root_key\": \"<base64 public key>\"}"); }
    if (!keyOk(b?.root_key)) return bad(c, "bad_root_key", "root_key must be a 32-byte Ed25519 public key in base64.");
    const have: any = await c.env.DB.prepare("SELECT root_key FROM rotation_roots WHERE app_id = ?").bind(appId).first();
    if (have && have.root_key === b.root_key) return c.json({ ok: true, root_key: b.root_key });
    if (have) {
      const n: any = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM rotations WHERE app_id = ?").bind(appId).first();
      if (n && Number(n.n) > 0) return bad(c, "root_key_locked", "A different root key is registered and statements are stored. The root key cannot be changed over the air.", 409);
    }
    const at = new Date().toISOString();
    // Both writes are conditional on no stored statements, so a statement stored after the check above cannot be orphaned.
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO rotation_roots (app_id, root_key, created_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM rotations WHERE app_id = ?) ON CONFLICT(app_id) DO UPDATE SET root_key = excluded.root_key, created_at = excluded.created_at").bind(appId, b.root_key, at, appId),
      c.env.DB.prepare("INSERT INTO audit_log_v2 (app_id, at, actor, actor_kind, action, release, release_id, before, after) SELECT ?, ?, ?, 'person', 'key-rotation', NULL, NULL, ?, ? WHERE NOT EXISTS (SELECT 1 FROM rotations WHERE app_id = ?)").bind(appId, at, g.s.actor, have ? String(have.root_key) : null, `root key registered: ${b.root_key}`, appId),
    ]);
    const now: any = await c.env.DB.prepare("SELECT root_key FROM rotation_roots WHERE app_id = ?").bind(appId).first();
    if (!now || now.root_key !== b.root_key) return bad(c, "root_key_locked", "A different root key is registered and statements are stored. The root key cannot be changed over the air.", 409);
    return c.json({ ok: true, root_key: b.root_key });
  });

  r.post("/:app", async (c) => {
    const appId = c.req.param("app");
    const g: any = await gate(c, appId); if (g.res) return g.res;
    let env: any; try { env = await c.req.json(); } catch { return bad(c, "bad_json", "body must be the envelope {\"body\": \"...\", \"signature\": \"...\"}"); }
    if (typeof env?.body !== "string" || typeof env?.signature !== "string" || enc.encode(env.body).length > MAX_BODY_BYTES) return bad(c, "bad_envelope", `body and signature must be strings and body at most ${MAX_BODY_BYTES} bytes.`);
    const root: any = await c.env.DB.prepare("SELECT root_key FROM rotation_roots WHERE app_id = ?").bind(appId).first();
    if (!root) return bad(c, "no_root_key", "Register the root public key first with PUT /rotation/<app>/root.", 409);
    let good = false;
    try { good = await ed.verifyAsync(unb64(env.signature), enc.encode(env.body), unb64(root.root_key)); } catch { good = false; }
    if (!good) return bad(c, "bad_signature", "The signature does not verify against the registered root key.");
    let s: any; try { s = JSON.parse(env.body); } catch { return bad(c, "bad_body", "body is not JSON."); }
    if (!s || typeof s !== "object" || Array.isArray(s)) return bad(c, "bad_body", "body must be a JSON object.");
    if (s.type !== "key-rotation") return bad(c, "wrong_type", "type must be key-rotation.");
    if (s.appId !== appId) return bad(c, "wrong_app", "appId does not match this app.");
    if (!Number.isSafeInteger(s.sequence) || s.sequence < 1) return bad(c, "bad_sequence", "sequence must be an integer, at least 1.");
    if (!keyOk(s.newKey)) return bad(c, "bad_key", "newKey must be a 32-byte Ed25519 public key in base64.");
    if (typeof s.validFrom !== "string" || Number.isNaN(Date.parse(s.validFrom))) return bad(c, "bad_body", "validFrom must be an ISO 8601 UTC time.");
    const top: any = await c.env.DB.prepare("SELECT MAX(sequence) AS top FROM rotations WHERE app_id = ?").bind(appId).first();
    const highest = Number(top?.top ?? 0) || 0;
    if (s.sequence <= highest) return bad(c, "replay", `sequence ${s.sequence} is not above the highest stored (${highest}).`, 409);
    const at = new Date().toISOString();
    // One batch: the statement and its audit row are stored together or not at all.
    try {
      await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO rotations (app_id, sequence, body, signature, created_at) VALUES (?, ?, ?, ?, ?)").bind(appId, s.sequence, env.body, env.signature, at),
      c.env.DB.prepare("INSERT INTO audit_log_v2 (app_id, at, actor, actor_kind, action, release, release_id, before, after) VALUES (?, ?, ?, 'person', 'key-rotation', NULL, NULL, NULL, ?)").bind(appId, at, g.s.actor, JSON.stringify({ sequence: s.sequence, validFrom: s.validFrom })),
      ]);
    } catch (e) {
      // A concurrent upload of the same sequence hits the primary key: that is a replay, not a server error.
      if (/UNIQUE|constraint/i.test(String((e as any)?.message ?? e))) {
        const t: any = await c.env.DB.prepare("SELECT MAX(sequence) AS top FROM rotations WHERE app_id = ?").bind(appId).first();
        const now = Number(t?.top ?? 0) || 0;
        if (now >= s.sequence) return bad(c, "replay", `sequence ${s.sequence} is not above the highest stored (${now}).`, 409);
      }
      throw e;
    }
    return c.json({ ok: true, sequence: s.sequence, validFrom: s.validFrom });
  });

  return r;
}
