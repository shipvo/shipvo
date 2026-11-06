// Trust for device telemetry (#733): per-install keys, replay guard, network hashes and rate limits.
// Nothing here makes a report "true". It makes forging expensive: a report counts toward auto-halt only if it was
// signed with a key that was registered through a rate-limited call, once per install, from a spread of networks.
import { Telemetry, TelemetryRegister, canonicalize } from "@shipvo/schema";

export const DEFAULT_MIN_REPORTS = 50;
export const DEFAULT_MIN_INSTALLS = 20;
export const DEFAULT_MIN_NETWORKS = 3;
/** An install registered less than this long ago is "fresh". */
export const FRESH_MS = 3600_000;

type Kv = { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> };
type TrustEnv = { POINTERS?: Kv; TELEMETRY_SECRET?: string; OWNER_TOKEN?: string; ADMIN_PASSWORD?: string };

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
function eq(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

/** Server secret that signs install tokens. Without any secret, nothing can be verified and every report is unverified. */
export const serverSecret = (env: TrustEnv) => env.TELEMETRY_SECRET || env.OWNER_TOKEN || env.ADMIN_PASSWORD || null;

/** Fixed-window counter in KV. Returns false when over the limit. Counter errors fail open: telemetry must never break the phone. */
export async function rateLimit(kv: Kv | undefined, name: string, limit: number, windowSec = 60): Promise<boolean> {
  if (!kv) return true;
  try {
    const key = `rl/${name}/${Math.floor(Date.now() / (windowSec * 1000))}`;
    const n = (Number(await kv.get(key)) || 0) + 1;
    if (n > limit) return false;
    await kv.put(key, String(n), { expirationTtl: Math.max(60, windowSec * 2) });
    return true;
  } catch { return true; }
}

export const clientIp = (c: any): string | null => c.req.header("cf-connecting-ip") || null;

/** Salted hash of the caller's /24 (IPv4) or /48 (IPv6), per app. Null when there is no IP (self-hosted without Cloudflare). */
export async function netHash(env: TrustEnv, appId: string, ip: string | null): Promise<string | null> {
  const secret = serverSecret(env);
  if (!ip || !secret) return null;
  const net = ip.includes(":") ? ip.split(":").slice(0, 3).join(":") : ip.split(".").slice(0, 3).join(".");
  return (await hmacHex(secret, `net|${appId}|${net}`)).slice(0, 16);
}

const installKey = (app: string, id: string) => `install/${app}/${id}`;
const tokenFor = async (secret: string, app: string, id: string, shell: string, keyHash: string) => hmacHex(secret, `t1|${app}|${id}|${shell}|${keyHash}`);

/** `POST /t/register` core. Idempotent for the same key; a different key for a known install id is refused. */
export async function registerInstall(env: TrustEnv, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const p = TelemetryRegister.safeParse(body);
  if (!p.success) return { status: 400, json: { error: "bad_register" } };
  const secret = serverSecret(env);
  if (!secret || !env.POINTERS) return { status: 503, json: { error: "registration_unavailable" } };
  const r = p.data, keyHash = await sha(r.install_key);
  const raw = await env.POINTERS.get(installKey(r.app_id, r.install_id));
  let at = Date.now();
  if (raw) {
    try { const v = JSON.parse(raw); if (v.h !== keyHash || v.s !== r.shell_version) return { status: 409, json: { error: "install_exists" } }; at = v.at; } catch { return { status: 409, json: { error: "install_exists" } }; }
  } else {
    await env.POINTERS.put(installKey(r.app_id, r.install_id), JSON.stringify({ k: r.install_key, h: keyHash, s: r.shell_version, at }), { expirationTtl: 400 * 86400 });
  }
  return { status: 200, json: { install_token: await tokenFor(secret, r.app_id, r.install_id, r.shell_version, keyHash), registered_at: new Date(at).toISOString() } };
}

export type ReportTrust = { verified: boolean; duplicate: boolean; installId: string | null; fresh: boolean; seenKey?: string };

/** Check the token and the body HMAC. A replayed body (same HMAC) is a duplicate and is not stored again. Read-only: call `markSeen` with the returned `seenKey` once the report is accepted, so a rate-limited request does not burn its replay key. */
export async function verifyReport(env: TrustEnv, d: Telemetry, body: Record<string, unknown>): Promise<ReportTrust> {
  const none: ReportTrust = { verified: false, duplicate: false, installId: null, fresh: false };
  const secret = serverSecret(env);
  if (!secret || !env.POINTERS || !d.install_id || !d.install_token || !d.sig) return none;
  try {
    const raw = await env.POINTERS.get(installKey(d.app_id, d.install_id));
    if (!raw) return none;
    const rec = JSON.parse(raw) as { k: string; h: string; s: string; at: number };
    if (!eq(d.install_token, await tokenFor(secret, d.app_id, d.install_id, rec.s, rec.h))) return none;
    const { sig: _sig, ...unsigned } = body;
    if (!eq(d.sig, await hmacHex(rec.k, canonicalize(unsigned)))) return none;
    const seen = `seen/${d.app_id}/${d.sig}`;
    if (await env.POINTERS.get(seen)) return { verified: true, duplicate: true, installId: d.install_id, fresh: false };
    return { verified: true, duplicate: false, installId: d.install_id, fresh: Date.now() - rec.at < FRESH_MS, seenKey: seen };
  } catch { return none; }
}

/** Remember an accepted report body so a replay is a duplicate. Never throws. */
export async function markSeen(env: TrustEnv, seenKey: string | undefined): Promise<void> {
  if (!seenKey || !env.POINTERS) return;
  try { await env.POINTERS.put(seenKey, "1", { expirationTtl: 86400 }); } catch { /* replay guard is best effort */ }
}
