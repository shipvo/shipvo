import { Hono } from "hono";

type Env = { POINTERS: KVNamespace; DB: D1Database; TELEMETRY_SECRET?: string };
export const installs = new Hono<{ Bindings: Env }>();

const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const INSTALL_ID = /^[A-Za-z0-9_-]{8,64}$/;

export async function sha256Hex(s: string) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
export async function hmacHex(secret: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
function safeEqual(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

/**
 * The HMAC secret for reports is the SHA-256 of the install key. The server keeps only that hash
 * (`key_hash`), so it can check signatures without storing the key itself. The client computes the
 * same value from its key: sig = HMAC-SHA256(sha256hex(key), rawBody), hex.
 */
export const signingSecret = (key: string) => sha256Hex(key);

/** First 24 bits of an IPv4 or 48 bits of an IPv6 address, as a string. Null if not an IP. */
export function netPrefix(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `4:${v4[1]}.${v4[2]}.${v4[3]}`;
  if (!ip.includes(":")) return null;
  const [head, tail, extra] = ip.split("::");
  if (extra !== undefined) return null;
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return "6:" + groups.slice(0, 3).map((g) => g.toLowerCase().padStart(4, "0")).join(":");
}
/** Salted hash of the network prefix. The salt is per app and derived from the server secret. */
export async function netHash(secret: string | undefined, appId: string, ip: string | undefined | null) {
  const p = netPrefix(ip);
  if (!secret || !p) return null;
  return hmacHex(await hmacHex(secret, `net-salt/${appId}`), p);
}

/** Does `sig` match the body, signed by the install's key? Any failure is false, never an error. */
export async function verifyReport(db: D1Database, appId: string, installId: unknown, sig: unknown, rawBody: string): Promise<boolean> {
  if (typeof installId !== "string" || typeof sig !== "string" || !INSTALL_ID.test(installId) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  try {
    const row = await db.prepare("SELECT key_hash FROM installs WHERE app_id = ? AND install_id = ?").bind(appId, installId).first<{ key_hash: string }>();
    if (!row) return false;
    return safeEqual(sig, await hmacHex(row.key_hash, rawBody));
  } catch { return false; }
}

export const REGISTER_LIMITS = { perIp: 20, perApp: 200, windowSeconds: 3600 };

/** Fixed-window counter in KV. Not atomic: concurrent calls can undercount a little. Fine for abuse control. */
async function overLimit(kv: KVNamespace, key: string, max: number): Promise<boolean> {
  const n = (Number(await kv.get(key)) || 0) + 1;
  await kv.put(key, String(n), { expirationTtl: REGISTER_LIMITS.windowSeconds + 60 });
  return n > max;
}

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

installs.post("/t/register", async (c) => {
  const secret = c.env.TELEMETRY_SECRET;
  if (!secret) return c.json({ error: "register_unavailable" }, 503);
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const bucket = Math.floor(Date.now() / (REGISTER_LIMITS.windowSeconds * 1000));
  try {
    const limited = (await overLimit(c.env.POINTERS, `register_rl/ip/${await sha256Hex(ip)}/${bucket}`, REGISTER_LIMITS.perIp));
    if (limited) return c.json({ error: "rate_limited" }, 429, { "retry-after": String(REGISTER_LIMITS.windowSeconds) });
  } catch (e) { console.error("register rate limit (ip) failed", e); }

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "bad_json" }, 400); }
  const appId = body?.app_id, installId = body?.install_id, shell = body?.shell_version;
  if (typeof appId !== "string" || !ID.test(appId) || typeof installId !== "string" || !INSTALL_ID.test(installId) || typeof shell !== "string" || shell.length === 0 || shell.length > 40) return c.json({ error: "bad_register" }, 400);

  try {
    if (await overLimit(c.env.POINTERS, `register_rl/app/${appId}/${bucket}`, REGISTER_LIMITS.perApp)) return c.json({ error: "rate_limited" }, 429, { "retry-after": String(REGISTER_LIMITS.windowSeconds) });
  } catch (e) { console.error("register rate limit (app) failed", e); }

  const existing = await c.env.DB.prepare("SELECT key_hash FROM installs WHERE app_id = ? AND install_id = ?").bind(appId, installId).first<{ key_hash: string }>();
  if (existing) {
    // Rotate only for the holder of the old key.
    const old = body?.old_key;
    if (typeof old !== "string" || !safeEqual(await signingSecret(old), existing.key_hash)) return c.json({ error: "already_registered" }, 409);
  }
  const key = hex(crypto.getRandomValues(new Uint8Array(32)));
  const keyHash = await signingSecret(key);
  const nh = await netHash(secret, appId, ip);
  if (existing) {
    await c.env.DB.prepare("UPDATE installs SET key_hash = ?, shell_version = ?, net_hash = ? WHERE app_id = ? AND install_id = ?").bind(keyHash, shell, nh, appId, installId).run();
  } else {
    await c.env.DB.prepare("INSERT INTO installs (app_id, install_id, key_hash, shell_version, net_hash) VALUES (?,?,?,?,?)").bind(appId, installId, keyHash, shell, nh).run();
  }
  const payload = b64url(JSON.stringify({ app_id: appId, install_id: installId, shell_version: shell, iat: Math.floor(Date.now() / 1000) }));
  const token = `${payload}.${await hmacHex(secret, `register-token/${payload}`)}`;
  return c.json({ install_id: installId, key, token }, existing ? 200 : 201, { "cache-control": "no-store" });
});
