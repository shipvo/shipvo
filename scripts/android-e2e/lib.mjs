// Pure helpers for the Android device lab: pointer building, tamper modes, statistics, log parsing.
import { createHash } from "node:crypto";
import { signBytes } from "../../packages/cli/dist/index.js";

export const sha256 = (b) => createHash("sha256").update(b).digest("hex");
export const median = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10;
};

/**
 * Builds the signed pointer envelope the runtime fetches, in the same wire format `shipvo publish` writes.
 * tamper: undefined | "signature" | "hash" | "size".
 *  - signature: the body is signed, then one byte of the body changes, so the signature no longer matches.
 *  - hash: the pointer is validly signed but names the wrong sha256 for the bundle.
 *  - size: the pointer is validly signed but names the wrong size.
 */
export function buildPointer({ app, seed, release, band, bytes, url, patches = [], minShell = "1.0.0", tamper, issuedAt = new Date().toISOString() }) {
  const core = { version: `1.0.${release}`, sha256: sha256(bytes), size: bytes.length, url, patches };
  if (tamper === "hash") core.sha256 = sha256(Buffer.concat([Buffer.from(bytes), Buffer.from("x")]));
  if (tamper === "size") core.size = bytes.length + 7;
  const body = JSON.stringify({ schema_version: "1.0", app_id: app, shell_major: 1, band, release, issued_at: issuedAt, core, addons: [], screens: [], min_shell_version: minShell });
  const signature = signBytes(new TextEncoder().encode(body), seed);
  if (tamper === "signature") return { body: body.replace('"issued_at":"', '"issued_at":"0'), signature };
  return { body, signature };
}

/** Parses the server's JSON-lines log. */
export const parseLog = (text) => text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

/** Telemetry events (POST /t) from a parsed log, with the server receive time in ms. */
export const telemetry = (entries) => entries.filter((e) => e.method === "POST" && e.path === "/t").map((e) => { try { return { at: e.t, ...JSON.parse(e.body) }; } catch { return null; } }).filter(Boolean);

/** Percent change from base to now; positive means slower or larger. */
export const pctChange = (base, now) => (base ? Math.round(((now - base) / base) * 1000) / 10 : null);
