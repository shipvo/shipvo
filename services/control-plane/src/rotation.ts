// Key rotation routes (docs/design/key-rotation.md sections 3, 6 and 10).
// The control plane is a courier: it checks the root signature and stores the envelope. Phones verify again.
// Admin session only. A publish token, the owner token (agents hold it) or no credential never rotates.
import { Hono } from "hono";
import { AGENT_ACTOR } from "./owner";
import { getRootKey, setRootKey, highestSequence, insertRotation, recordRotationLog } from "./rotation-store";

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_BODY_BYTES = 1024;
const enc = new TextEncoder();
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));

function key32(s: unknown): Uint8Array | null {
  if (typeof s !== "string") return null;
  try { const b = unb64(s); return b.length === 32 ? b : null; } catch { return null; }
}

async function verifyEd25519(pub: Uint8Array, sig: string, body: string): Promise<boolean> {
  let signature: Uint8Array;
  try { signature = unb64(sig); } catch { return false; }
  for (const alg of ["Ed25519", "NODE-ED25519"]) {
    try {
      const k = await crypto.subtle.importKey("raw", pub, { name: alg, namedCurve: "Ed25519" } as any, false, ["verify"]);
      return await crypto.subtle.verify({ name: alg } as any, k, signature, enc.encode(body));
    } catch { /* try the other algorithm name */ }
  }
  return false;
}

const fail = (c: any, status: 400 | 409, reason: string, message: string) => c.json({ ok: false, error: reason, reason, message }, status);

export function rotationRoutes(owner: (c: any, appId: string) => Promise<string | null>) {
  const r = new Hono<{ Bindings: any }>();

  /** Admin session only: 401 with nothing, 403 for any token (publish token or owner token). */
  async function admin(c: any, appId: string): Promise<{ actor: string } | Response> {
    if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
    const actor = await owner(c, appId);
    if (actor === AGENT_ACTOR) return c.json({ error: "forbidden", message: "Only the owner signed in to the admin can change signing keys. A token cannot." }, 403);
    if (!actor) return c.json({ error: (c.req.header("authorization") ?? "") ? "forbidden" : "unauthorized", message: "Sign in as the app owner. Tokens cannot rotate keys." }, (c.req.header("authorization") ?? "") ? 403 : 401);
    return { actor };
  }

  /** Register the root public key for an app. */
  r.put("/:app/root", async (c) => {
    const appId = c.req.param("app");
    const a = await admin(c, appId); if (a instanceof Response) return a;
    const j: any = await c.req.json().catch(() => null);
    if (!key32(j?.root_key)) return fail(c, 400, "bad_root_key", "root_key must be the base64 Ed25519 root public key (32 bytes).");
    await setRootKey(c.env.DB, appId, j.root_key);
    return c.json({ ok: true, app: appId, root_key: j.root_key });
  });

  /** Upload a root-signed rotation statement. */
  r.post("/:app", async (c) => {
    const appId = c.req.param("app");
    const a = await admin(c, appId); if (a instanceof Response) return a;
    const env: any = await c.req.json().catch(() => null);
    if (typeof env?.body !== "string" || typeof env?.signature !== "string" || enc.encode(env.body).length > MAX_BODY_BYTES) return fail(c, 400, "bad_envelope", "Send { body, signature }: two strings, body at most 1 KB.");
    const rootKey = await getRootKey(c.env.DB, appId);
    const root = rootKey ? key32(rootKey) : null;
    if (!root) return fail(c, 409, "no_root_key", "Register the root public key first with PUT /rotation/<app>/root.");
    if (!(await verifyEd25519(root, env.signature, env.body))) return fail(c, 400, "bad_signature", "The signature does not verify against the registered root key.");
    let s: any;
    try { s = JSON.parse(env.body); } catch { return fail(c, 400, "bad_body", "body is not JSON."); }
    if (s?.type !== "key-rotation") return fail(c, 400, "wrong_type", "type must be key-rotation.");
    if (s.appId !== appId) return fail(c, 400, "wrong_app", "appId does not match this app.");
    if (!Number.isSafeInteger(s.sequence) || s.sequence < 1) return fail(c, 400, "bad_sequence", "sequence must be a whole number, at least 1.");
    if (!key32(s.newKey)) return fail(c, 400, "bad_key", "newKey must be a 32-byte Ed25519 public key (base64).");
    if (typeof s.validFrom !== "string" || Number.isNaN(Date.parse(s.validFrom))) return fail(c, 400, "bad_valid_from", "validFrom must be an ISO 8601 UTC time.");
    if (!(await insertRotation(c.env.DB, appId, s.sequence, { body: env.body, signature: env.signature }, s.validFrom))) {
      return c.json({ ok: false, error: "replay", reason: "replay", message: `sequence ${s.sequence} is not above the highest stored (${await highestSequence(c.env.DB, appId)}).` }, 409);
    }
    await recordRotationLog(c.env.DB, { app_id: appId, actor: a.actor, actor_kind: "person", sequence: s.sequence, valid_from: s.validFrom });
    return c.json({ ok: true, app: appId, sequence: s.sequence, valid_from: s.validFrom });
  });

  return r;
}
