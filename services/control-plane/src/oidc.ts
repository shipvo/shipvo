// OIDC ID token verification and claim-to-role mapping. Not wired to any route or to auth.ts yet.
import type { Role } from "./roles.js";

export type OidcAlg = "RS256" | "ES256";
const ALGS: readonly OidcAlg[] = ["RS256", "ES256"];
const ROLES: readonly Role[] = ["viewer", "developer", "release_manager", "admin"];

export interface RoleMapping {
  /** Claim that holds the user's groups. Default "groups". */
  groupClaim?: string;
  /** Group name to role. */
  groups?: Record<string, Role>;
  /** Email domain (lower case, no "@") to role. Used only when the email is verified. */
  emailDomains?: Record<string, Role>;
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  /** https URL of the issuer's JWKS. */
  jwksUri: string;
  mapping: RoleMapping;
  /** Allowed signing algorithms. Default: RS256 and ES256. */
  algorithms?: OidcAlg[];
  /** Allowed clock skew in seconds. Default 60. */
  clockSkewSec?: number;
  /** Seconds to keep a fetched JWKS. Default 3600. */
  jwksTtlSec?: number;
  /** Minimum seconds between refetches triggered by an unknown kid. Default 60. */
  jwksMinRefetchSec?: number;
}

export interface JwksCache {
  keys: JsonWebKey[];
  fetchedAt: number;
}

export interface OidcDeps {
  fetch: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  now?: () => number; // ms
  cache?: Map<string, JwksCache>;
}

export class OidcError extends Error {
  constructor(public reason: string) {
    super(`oidc: ${reason}`);
  }
}

export type Claims = Record<string, unknown>;

const defaultCache = new Map<string, JwksCache>();

/** Returns a list of problems; empty means the config is valid. */
export function validateOidcConfig(c: Partial<OidcConfig> | null | undefined): string[] {
  const errs: string[] = [];
  if (!c || typeof c !== "object") return ["config is required"];
  const https = (v: unknown) => {
    try { return typeof v === "string" && new URL(v).protocol === "https:"; } catch { return false; }
  };
  if (!https(c.issuer)) errs.push("issuer must be an https URL");
  if (!https(c.jwksUri)) errs.push("jwksUri must be an https URL");
  if (typeof c.clientId !== "string" || !c.clientId) errs.push("clientId is required");
  const m = c.mapping;
  const g = m?.groups ?? {};
  const d = m?.emailDomains ?? {};
  if (!m || (Object.keys(g).length + Object.keys(d).length === 0)) errs.push("mapping needs at least one group or email domain");
  for (const r of [...Object.values(g), ...Object.values(d)]) if (!ROLES.includes(r)) errs.push(`unknown role: ${String(r)}`);
  for (const a of c.algorithms ?? []) if (!ALGS.includes(a)) errs.push(`algorithm not allowed: ${String(a)}`);
  return errs;
}

function b64urlBytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new OidcError("malformed token");
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(p);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseJson(s: string): Claims {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Claims;
  } catch (e) {
    if (e instanceof OidcError) throw e;
  }
  throw new OidcError("malformed token");
}

async function loadKeys(config: OidcConfig, deps: OidcDeps, force: boolean): Promise<JwksCache> {
  const cache = deps.cache ?? defaultCache;
  const now = (deps.now ?? Date.now)();
  const hit = cache.get(config.jwksUri);
  const ttl = (config.jwksTtlSec ?? 3600) * 1000;
  const minGap = (config.jwksMinRefetchSec ?? 60) * 1000;
  if (hit && now - hit.fetchedAt < ttl && !(force && now - hit.fetchedAt >= minGap)) return hit;
  const res = await deps.fetch(config.jwksUri);
  if (!res.ok) throw new OidcError("jwks fetch failed");
  const body = (await res.json()) as { keys?: unknown };
  if (!body || !Array.isArray(body.keys)) throw new OidcError("jwks malformed");
  const fresh = { keys: body.keys as JsonWebKey[], fetchedAt: now };
  cache.set(config.jwksUri, fresh);
  return fresh;
}

const findKey = (keys: JsonWebKey[], kid: string) =>
  keys.find((k) => (k as { kid?: string }).kid === kid && (k.use === undefined || k.use === "sig"));

async function importKey(jwk: JsonWebKey, alg: OidcAlg): Promise<CryptoKey> {
  if (alg === "RS256" && jwk.kty === "RSA") {
    return crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  }
  if (alg === "ES256" && jwk.kty === "EC" && jwk.crv === "P-256") {
    return crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }
  throw new OidcError("key does not match algorithm");
}

/** Verifies an ID token. Returns its claims, or throws OidcError. */
export async function verifyIdToken(token: string, config: OidcConfig, deps: OidcDeps, expected: { nonce: string }): Promise<Claims> {
  const bad = validateOidcConfig(config);
  if (bad.length) throw new OidcError(`invalid config: ${bad[0]}`);
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) throw new OidcError("malformed token");
  const header = parseJson(parts[0]!);
  const alg = header.alg;
  const allowed = config.algorithms ?? ALGS;
  if (typeof alg !== "string" || !ALGS.includes(alg as OidcAlg) || !allowed.includes(alg as OidcAlg)) throw new OidcError("algorithm not allowed");
  const kid = header.kid;
  if (typeof kid !== "string" || !kid) throw new OidcError("missing kid");

  let set = await loadKeys(config, deps, false);
  let jwk = findKey(set.keys, kid);
  if (!jwk) {
    set = await loadKeys(config, deps, true); // at most once per min gap
    jwk = findKey(set.keys, kid);
  }
  if (!jwk) throw new OidcError("unknown kid");

  const key = await importKey(jwk, alg as OidcAlg);
  const sig = b64urlBytes(parts[2]!);
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const params = alg === "RS256" ? { name: "RSASSA-PKCS1-v1_5" } : { name: "ECDSA", hash: "SHA-256" };
  let ok = false;
  try { ok = await crypto.subtle.verify(params, key, sig, data); } catch { ok = false; }
  if (!ok) throw new OidcError("bad signature");

  const claims = parseJson(parts[1]!);
  const nowSec = Math.floor((deps.now ?? Date.now)() / 1000);
  const skew = config.clockSkewSec ?? 60;
  if (claims.iss !== config.issuer) throw new OidcError("wrong issuer");
  const aud = claims.aud;
  const auds = Array.isArray(aud) ? aud : [aud];
  if (!auds.includes(config.clientId)) throw new OidcError("wrong audience");
  if (Array.isArray(aud) && aud.length > 1 && claims.azp !== config.clientId) throw new OidcError("wrong authorized party");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const exp = num(claims.exp);
  if (exp === undefined) throw new OidcError("missing exp");
  if (exp + skew <= nowSec) throw new OidcError("token expired");
  const nbf = num(claims.nbf);
  if (claims.nbf !== undefined && (nbf === undefined || nbf - skew > nowSec)) throw new OidcError("token not yet valid");
  const iat = num(claims.iat);
  if (claims.iat !== undefined && (iat === undefined || iat - skew > nowSec)) throw new OidcError("iat in the future");
  if (typeof claims.nonce !== "string" || !expected.nonce || claims.nonce !== expected.nonce) throw new OidcError("wrong nonce");
  if (typeof claims.sub !== "string" || !claims.sub) throw new OidcError("missing sub");
  return claims;
}

const RANK: Record<Role, number> = { viewer: 0, developer: 1, release_manager: 2, admin: 3 };

/** Maps verified claims to a role. The highest matching role wins. null means no access. */
export function mapClaimsToRole(claims: Claims, mapping: RoleMapping): Role | null {
  const found: Role[] = [];
  const own = (o: Record<string, Role> | undefined, k: string): Role | undefined =>
    o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
  const raw = claims[mapping.groupClaim ?? "groups"];
  const groups = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  for (const g of groups) {
    const r = typeof g === "string" ? own(mapping.groups, g) : undefined;
    if (r && r in RANK) found.push(r);
  }
  const email = claims.email;
  if (typeof email === "string" && claims.email_verified === true) {
    const at = email.lastIndexOf("@");
    if (at > 0) {
      const r = own(mapping.emailDomains, email.slice(at + 1).toLowerCase());
      if (r && r in RANK) found.push(r);
    }
  }
  if (!found.length) return null;
  return found.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
}
