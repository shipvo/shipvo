// Fixed-window counters in KV for POST /t. Not atomic: concurrent calls can undercount a little. Fine for abuse control.
// Keys carry a hash or an id, never a raw IP.
import { sha256Hex } from "./installs";

export const TELEMETRY_LIMITS = { perIp: 300, perInstall: 30, perApp: 3000, windowSeconds: 60 };

async function over(kv: KVNamespace, key: string, max: number): Promise<boolean> {
  const n = (Number(await kv.get(key)) || 0) + 1;
  await kv.put(key, String(n), { expirationTtl: TELEMETRY_LIMITS.windowSeconds * 2 });
  return n > max;
}
const bucket = () => Math.floor(Date.now() / (TELEMETRY_LIMITS.windowSeconds * 1000));

/** True if this source is over a limit. Storage errors count as not limited: telemetry must keep flowing. */
export async function telemetryLimited(kv: KVNamespace | undefined, scope: "ip" | "install" | "app", id: string): Promise<boolean> {
  if (!kv) return false;
  try {
    const max = scope === "ip" ? TELEMETRY_LIMITS.perIp : scope === "install" ? TELEMETRY_LIMITS.perInstall : TELEMETRY_LIMITS.perApp;
    return await over(kv, `t_rl/${scope}/${scope === "ip" ? await sha256Hex(id) : id}/${bucket()}`, max);
  } catch (e) { console.error("telemetry rate limit failed", e); return false; }
}
