// Signed telemetry (#733). On first launch an install makes a random id and key and registers once
// (`POST /t/register`). Every report then carries the id, the server's token and an HMAC over the report.
// The control plane counts only verified reports toward auto-halt. Without this, reports still work but count as unverified.

/** Same output as `canonicalize` in @shipvo/schema (sorted keys, no whitespace), kept here so the runtime has no extra dependency. */
function canonicalize(value: unknown): string {
  const sort = (v: any): any => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(value));
}

export type InstallStorage = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };
export type InstallIdentity = { install_id: string; install_key: string; install_token: string; shell_version: string };
/** Defaults to `globalThis.crypto`. Hermes has no `crypto.subtle`: pass an adapter (for example one built on expo-crypto). */
export type TelemetryCrypto = { randomHex(bytes: number): string; hmacSha256Hex(key: string, message: string): Promise<string> };

const STORE_KEY = "shipvo.install.v1";

export const webCrypto: TelemetryCrypto = {
  randomHex: (n) => [...globalThis.crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join(""),
  async hmacSha256Hex(key, message) {
    const enc = new TextEncoder();
    const k = await globalThis.crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return [...new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", k, enc.encode(message)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  },
};

/** Load the stored identity, or create and register one. Returns null if registration fails (reports then go unsigned). */
export async function ensureInstallIdentity(opts: { baseUrl: string; appId: string; shellVersion: string; storage: InstallStorage; crypto?: TelemetryCrypto; fetch?: typeof fetch }): Promise<InstallIdentity | null> {
  const c = opts.crypto ?? webCrypto, f = opts.fetch ?? fetch;
  try {
    const saved = await opts.storage.get(STORE_KEY);
    if (saved) { const v = JSON.parse(saved) as InstallIdentity; if (v.install_id && v.install_key && v.install_token && v.shell_version === opts.shellVersion) return v; }
  } catch { /* unreadable: register again */ }
  const install_id = c.randomHex(16), install_key = c.randomHex(32);
  try {
    const r = await f(`${opts.baseUrl.replace(/\/$/, "")}/t/register`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ schema_version: "1.0", app_id: opts.appId, install_id, install_key, shell_version: opts.shellVersion }) });
    if (!r.ok) return null;
    const { install_token } = (await r.json()) as { install_token?: string };
    if (!install_token) return null;
    const id = { install_id, install_key, install_token, shell_version: opts.shellVersion };
    await opts.storage.set(STORE_KEY, JSON.stringify(id));
    return id;
  } catch { return null; }
}

/** Add the install id, token and HMAC to a report. The key itself is never sent with a report. */
export async function signReport<T extends Record<string, unknown>>(identity: InstallIdentity, report: T, crypto: TelemetryCrypto = webCrypto): Promise<T & { install_id: string; install_token: string; sig: string }> {
  const body = { ...report, install_id: identity.install_id, install_token: identity.install_token };
  return { ...body, sig: await crypto.hmacSha256Hex(identity.install_key, canonicalize(body)) };
}
