// Signed telemetry for the sample app. Reports to `/t` carry an install id and an HMAC signature, so the
// control plane's auto-halt counts them. The identity is created once by the runtime's `enableSignedTelemetry`, so
// the runtime's own events (rollback, crash) and the app's reports share one install id.
// No new native modules: storage is expo-file-system (already in the shell), HMAC is pure JS from @noble/hashes.
// If registration fails, reports go out unsigned for the rest of the launch (one attempt per launch).
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import {
  enableSignedTelemetry, signReport,
  type InstallIdentity, type TelemetryCrypto, type TelemetryStorage,
} from "@shipvo/runtime";

/** Keeps the identity in a file in the app's document folder. Falls back to memory if the file module is missing. */
export function fileStorage(): TelemetryStorage {
  try {
    const { File, Paths } = require("expo-file-system");
    const f = new File(Paths.document, "shipvo-install.json");
    return {
      getItem: () => (f.exists ? f.textSync() : null),
      setItem: async (_k, v) => {
        if (!f.exists) f.create({ intermediates: true });
        await f.write(v);
      },
    };
  } catch {
    let v: string | null = null;
    return { getItem: () => v, setItem: (_k, s) => { v = s; } };
  }
}

/**
 * Pure-JS crypto. The install id only has to be unique (the secret key comes from the server), so when
 * `crypto.getRandomValues` is missing on the JS engine we fall back to `Math.random`.
 */
export function portableCrypto(): TelemetryCrypto {
  return {
    randomBytes: (n) => {
      const out = new Uint8Array(n);
      const c = (globalThis as any).crypto;
      if (typeof c?.getRandomValues === "function") c.getRandomValues(out);
      else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
      return out;
    },
    hmacSha256: (key, data) => hmac(sha256, key, data),
  };
}

/** The exact body to POST: `body` with `install_id` added and the `sig` suffix. Falls back to plain JSON. */
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

/**
 * One reporter per base URL. It calls the runtime's `enableSignedTelemetry` (which the runtime's own event reports
 * use too) and signs the app's reports with the same identity. Registration is tried once per launch, so a failure cannot flood the register endpoint.
 * Never throws.
 */
export function createReporter(
  baseUrl: string, storage: TelemetryStorage = fileStorage(), crypto: TelemetryCrypto = portableCrypto(),
): Reporter & { start(): Promise<InstallIdentity | null> } {
  let ready: Promise<InstallIdentity | null> | null = null;
  const start = () => {
    ready ??= enableSignedTelemetry({ storage, crypto, registerUrl: `${baseUrl}/t/register` })
      .catch(() => null);
    return ready;
  };
  return {
    start,
    async body(b) { return signedBody(await start(), b, crypto); },
  };
}

const reporters = new Map<string, ReturnType<typeof createReporter>>();
/** POST `body` to `${baseUrl}${path}`, signed when `sign` is set. Best effort: never throws. */
export async function postJson(
  baseUrl: string | undefined, path: string, body: Record<string, unknown>, sign = false,
  fetchFn: typeof fetch = fetch, reporterFor: (u: string) => Reporter = (u) => {
    let r = reporters.get(u); if (!r) { r = createReporter(u); reporters.set(u, r); } return r;
  },
) {
  if (!baseUrl) return;
  try {
    const text = sign ? await reporterFor(baseUrl).body(body) : JSON.stringify(body);
    await fetchFn(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: text });
  } catch {}
}

/** Start registration early (at app launch) so the runtime's own events can be signed too. */
export function startTelemetry(baseUrl: string | undefined) {
  if (!baseUrl) return;
  let r = reporters.get(baseUrl); if (!r) { r = createReporter(baseUrl); reporters.set(baseUrl, r); }
  void r.start();
}
