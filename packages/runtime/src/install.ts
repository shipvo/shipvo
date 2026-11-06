/**
 * Install identity for signed telemetry. On first launch the app makes a random install id and registers it once
 * (`POST registerUrl` with `{ install_id }`, answer `{ key }`). The key is a secret string. Reports are signed with
 * HMAC-SHA256, using the UTF-8 bytes of the key, and the signature is lower-case hex.
 *
 * Signing rule: the sent body is `<unsigned>` with its last `}` replaced by `,"sig":"<hex>"}`. The HMAC covers the
 * unsigned JSON string, including its closing `}`. To verify, the server cuts the suffix `,"sig":"<hex>"}` from the
 * received string, appends `}`, and checks the HMAC of that string.
 */
export type InstallIdentity = { install_id: string; key: string };

/** Where the identity lives. Pass an AsyncStorage-style adapter on React Native. */
export interface TelemetryStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
}

/** React Native has no `crypto.subtle`, so apps can pass their own. */
export interface TelemetryCrypto {
  /** Random bytes, for the install id. */
  randomBytes(n: number): Uint8Array | Promise<Uint8Array>;
  /** HMAC-SHA256 of `data` under `key`. */
  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

export const IDENTITY_STORAGE_KEY = "shipvo.install_identity";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Default for web and Node (needs `globalThis.crypto.subtle`). */
export const webCrypto: TelemetryCrypto = {
  randomBytes: (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
  hmacSha256: async (key, data) => {
    const k = await globalThis.crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", k, data));
  },
};

/**
 * Load the stored identity, or create and register one. Returns `null` when registration fails (offline, server
 * error, bad answer); nothing is stored then and the next launch tries again. Never throws.
 */
export async function ensureInstallIdentity(
  storage: TelemetryStorage, crypto: TelemetryCrypto, registerUrl: string,
): Promise<InstallIdentity | null> {
  try {
    const raw = await storage.getItem(IDENTITY_STORAGE_KEY);
    if (raw) {
      let s: any = null;
      try { s = JSON.parse(raw); } catch {} // corrupted: register again
      if (typeof s?.install_id === "string" && typeof s?.key === "string") return { install_id: s.install_id, key: s.key };
    }
    const install_id = hex(await crypto.randomBytes(16));
    const res = await fetch(registerUrl, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ install_id }) });
    if (!res.ok) return null;
    const out: any = await res.json();
    if (typeof out?.key !== "string" || !out.key) return null;
    const identity = { install_id, key: out.key };
    await storage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
    return identity;
  } catch {
    return null;
  }
}

/** Sign `body`, the unsigned JSON string (with its closing `}`). See the signing rule at the top of this file. */
export async function signReport(
  identity: InstallIdentity, body: string, crypto: TelemetryCrypto = webCrypto,
): Promise<{ install_id: string; sig: string }> {
  const enc = new TextEncoder();
  const mac = await crypto.hmacSha256(enc.encode(identity.key), enc.encode(body));
  return { install_id: identity.install_id, sig: hex(mac) };
}
