/** Per-source caps for POST /t and POST /t/register. Fixed windows in KV. Only hashed IPs are stored. */
export const TELEMETRY_LIMITS = { perIp: 300, perInstall: 60, perApp: 1000, windowSeconds: 60 };
export const REGISTER_LIMITS = { perIp: 20, perInstall: 5, perApp: 200, windowSeconds: 3600 };

type Limits = { perIp: number; perInstall: number; perApp: number; windowSeconds: number };
export type Source = { ip?: string; appId?: string; installId?: string };

async function sha256Hex(s: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Count one request against a limit. Returns the seconds to wait when over the limit, otherwise 0.
 * KV read-then-put is not atomic: concurrent calls can undercount a little. Fine for abuse control.
 * A KV failure lets the request through, so telemetry is never lost to the limiter.
 */
export async function hit(kv: KVNamespace, route: string, limits: Limits, scope: "ip" | "install" | "app", id: string): Promise<number> {
  try {
    const win = limits.windowSeconds * 1000, now = Date.now(), bucket = Math.floor(now / win);
    const max = scope === "ip" ? limits.perIp : scope === "install" ? limits.perInstall : limits.perApp;
    const key = `${route}_rl/${scope}/${scope === "ip" ? await sha256Hex(id) : id}/${bucket}`;
    const n = (Number(await kv.get(key)) || 0) + 1;
    await kv.put(key, String(n), { expirationTtl: limits.windowSeconds + 60 });
    return n > max ? Math.max(1, Math.ceil(((bucket + 1) * win - now) / 1000)) : 0;
  } catch (e) { console.error("rate limit check failed (request allowed)", e); return 0; }
}

/** Check every scope that is known; returns the longest wait, or 0. */
export async function check(kv: KVNamespace | undefined, route: "telemetry" | "register", limits: Limits, s: Source): Promise<number> {
  if (!kv) return 0;
  const waits = [0];
  if (s.ip) waits.push(await hit(kv, route, limits, "ip", s.ip));
  if (s.installId) waits.push(await hit(kv, route, limits, "install", `${s.appId ?? ""}/${s.installId}`));
  if (s.appId) waits.push(await hit(kv, route, limits, "app", s.appId));
  return Math.max(...waits);
}

