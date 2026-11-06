// Signed telemetry for the sample app. Reports to `/t` carry an install id and an HMAC signature, so the
// control plane's auto-halt counts them. Storage and crypto are native modules on a phone, so they are loaded
// lazily. If they are missing (an older shell build) or registration fails, reports go out unsigned.
import {
  ensureInstallIdentity, signReport,
  type InstallIdentity, type TelemetryCrypto, type TelemetryStorage,
} from "@shipvo/runtime";

/** Keeps the install key in the platform keystore (iOS Keychain, Android Keystore). */
export function secureStorage(): TelemetryStorage {
  const SS = require("expo-secure-store");
  return {
    getItem: (k) => SS.getItemAsync(k),
    setItem: (k, v) => SS.setItemAsync(k, v),
  };
}

/** Random bytes from expo-crypto, HMAC-SHA256 from @noble/hashes (pure JS, works on Hermes). */
export function nativeCrypto(): TelemetryCrypto {
  const { getRandomBytes } = require("expo-crypto");
  const { hmac } = require("@noble/hashes/hmac");
  const { sha256 } = require("@noble/hashes/sha256");
  return {
    randomBytes: (n) => getRandomBytes(n),
    hmacSha256: (key, data) => hmac(sha256, key, data),
  };
}

/** The exact body to POST: `unsigned` with `install_id` added and the `sig` suffix. Falls back to plain JSON. */
export async function signedBody(
  identity: InstallIdentity | null, body: Record<string, unknown>, crypto: TelemetryCrypto,
): Promise<string> {
  if (!identity) return JSON.stringify(body);
  try {
    const unsigned = JSON.stringify({ ...body, install_id: identity.install_id });
    const { sig } = await signReport(identity, unsigned, crypto);
    return `${unsigned.slice(0, -1)},"sig":"${sig}"}`;
  } catch {
    return JSON.stringify(body);
  }
}

export type Reporter = { body(b: Record<string, unknown>): Promise<string> };

/** One reporter per base URL. Registers the install on first use (once per launch). Never throws. */
export function createReporter(
  baseUrl: string, storage?: TelemetryStorage, crypto?: TelemetryCrypto,
): Reporter {
  let ready: Promise<{ id: InstallIdentity | null; crypto: TelemetryCrypto | null }> | null = null;
  const init = async () => {
    try {
      const c = crypto ?? nativeCrypto();
      const id = await ensureInstallIdentity(storage ?? secureStorage(), c, `${baseUrl}/t/register`);
      return { id, crypto: c };
    } catch {
      return { id: null, crypto: null };
    }
  };
  return {
    async body(b) {
      ready ??= init();
      const { id, crypto: c } = await ready;
      return c ? signedBody(id, b, c) : JSON.stringify(b);
    },
  };
}
