// Single sign-on over OIDC: /sso/<org>/start and /sso/<org>/callback (slice 4b of #296).
// Uses the verifier and role mapping in oidc.ts. Sessions live in KV, keyed by a hash of the cookie value.
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { OidcError, mapClaimsToRole, validateOidcConfig, verifyIdToken, type OidcConfig, type OidcDeps } from "./oidc.js";

export interface SsoOrg extends OidcConfig {
  /** https URL of the provider's authorization endpoint. */
  authorizationEndpoint: string;
  /** https URL of the provider's token endpoint. */
  tokenEndpoint: string;
  /** Name of the Worker secret that holds the client secret. The secret itself is never in this config. */
  secretRef: string;
}

type SsoEnv = { POINTERS: KVNamespace; SSO_ORGS?: string; [secret: string]: unknown };
export interface SsoDeps {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  oidc?: Partial<OidcDeps>;
}

const STATE_TTL = 600;
const SESSION_TTL = 8 * 3600;
const ORG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const enc = new TextEncoder();
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
const safeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

const fail = (c: any, status: 400 | 403 | 404 | 502 | 503, error: string, message: string) => c.json({ error, message }, status, { "cache-control": "no-store" });

/** Reads one org's settings from the SSO_ORGS configuration (JSON object keyed by org). Null when absent or invalid. */
export function loadOrg(env: SsoEnv, org: string): SsoOrg | null {
  if (!ORG.test(org) || !env.SSO_ORGS) return null;
  try {
    const all = JSON.parse(env.SSO_ORGS) as Record<string, SsoOrg>;
    const o = Object.prototype.hasOwnProperty.call(all, org) ? all[org] : undefined;
    if (!o || validateOidcConfig(o).length) return null;
    const https = (v: unknown) => { try { return new URL(String(v)).protocol === "https:"; } catch { return false; } };
    if (!https(o.authorizationEndpoint) || !https(o.tokenEndpoint) || typeof o.secretRef !== "string" || !o.secretRef) return null;
    return o;
  } catch { return null; }
}

export function createSsoRoutes(deps: SsoDeps = {}) {
  const sso = new Hono<{ Bindings: SsoEnv }>();
  const doFetch = (url: string, init?: RequestInit) => (deps.fetch ?? fetch)(url, init);
  const redirectUri = (c: any, org: string) => `${new URL(c.req.url).origin}/sso/${org}/callback`;
  const cookiePath = (org: string) => `/sso/${org}`;

  sso.get("/sso/:org/start", async (c) => {
    const org = c.req.param("org");
    const cfg = loadOrg(c.env, org);
    if (!cfg) return fail(c, 404, "unknown_org", "Single sign-on is not set up for this organization.");
    const state = rand(24), nonce = rand(24), verifier = rand(48);
    await c.env.POINTERS.put(`sso/state/${state}`, JSON.stringify({ org, nonce, verifier }), { expirationTtl: STATE_TTL });
    const u = new URL(cfg.authorizationEndpoint);
    u.search = new URLSearchParams({
      response_type: "code", client_id: cfg.clientId, redirect_uri: redirectUri(c, org), scope: "openid email profile",
      state, nonce, code_challenge: b64url(await sha256(verifier)), code_challenge_method: "S256",
    }).toString();
    setCookie(c, "sv_sso_state", state, { httpOnly: true, secure: true, sameSite: "Lax", path: cookiePath(org), maxAge: STATE_TTL });
    return c.redirect(u.toString(), 302);
  });

  sso.get("/sso/:org/callback", async (c) => {
    const org = c.req.param("org");
    const cfg = loadOrg(c.env, org);
    if (!cfg) return fail(c, 404, "unknown_org", "Single sign-on is not set up for this organization.");
    if (c.req.query("error")) return fail(c, 400, "login_refused", "The identity provider did not sign you in. Start again.");
    const state = c.req.query("state") ?? "", code = c.req.query("code") ?? "";
    const bound = getCookie(c, "sv_sso_state") ?? "";
    deleteCookie(c, "sv_sso_state", { path: cookiePath(org) });
    if (!state || !code || !bound || !safeEqual(state, bound)) return fail(c, 400, "bad_state", "The sign-in state does not match. Start again.");
    // The state is single use: read it, then delete it. A second callback with the same state finds nothing.
    const key = `sso/state/${state}`;
    const raw = await c.env.POINTERS.get(key);
    await c.env.POINTERS.delete(key);
    let saved: { org: string; nonce: string; verifier: string } | null = null;
    try { saved = raw ? JSON.parse(raw) : null; } catch { saved = null; }
    if (!saved || saved.org !== org) return fail(c, 400, "bad_state", "This sign-in link was already used or has expired. Start again.");

    const secret = c.env[cfg.secretRef];
    if (typeof secret !== "string" || !secret) return fail(c, 503, "sso_not_configured", "Single sign-on is not fully set up for this organization.");
    let idToken: unknown;
    try {
      const res = await doFetch(cfg.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(c, org), client_id: cfg.clientId, client_secret: secret, code_verifier: saved.verifier }).toString(),
      });
      if (!res.ok) return fail(c, 400, "code_refused", "The identity provider refused the sign-in code. It may have been used already. Start again.");
      idToken = ((await res.json()) as { id_token?: unknown }).id_token;
    } catch { return fail(c, 502, "provider_unreachable", "Could not reach the identity provider. Try again."); }
    if (typeof idToken !== "string") return fail(c, 502, "no_id_token", "The identity provider did not return an ID token.");

    let claims;
    try {
      claims = await verifyIdToken(idToken, cfg, { fetch: (u) => doFetch(u), ...deps.oidc }, { nonce: saved.nonce });
    } catch (e) {
      if (e instanceof OidcError) return fail(c, 400, "token_rejected", `The ID token was not accepted (${e.reason}).`);
      return fail(c, 502, "provider_unreachable", "Could not check the ID token. Try again.");
    }
    const role = mapClaimsToRole(claims, cfg.mapping);
    if (!role) return fail(c, 403, "no_access", "Your account has no role in Shipvo. Ask an admin.");

    const token = `sv_sso_${rand(32)}`;
    const expires_at = new Date(Date.now() + SESSION_TTL * 1000).toISOString();
    const email = typeof claims.email === "string" ? claims.email : null;
    await c.env.POINTERS.put(`sso/session/${hex(await sha256(token))}`, JSON.stringify({ org, sub: claims.sub, email, role, expires_at }), { expirationTtl: SESSION_TTL });
    setCookie(c, "sv_sso", token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: SESSION_TTL });
    return c.json({ ok: true, org, role, email, expires_at }, 200, { "cache-control": "no-store" });
  });

  return sso;
}

/** Looks up the SSO session behind a cookie value. Null when missing or expired. */
export async function ssoSession(env: SsoEnv, token: string | undefined): Promise<{ org: string; sub: string; email: string | null; role: string; expires_at: string } | null> {
  if (!token || !token.startsWith("sv_sso_")) return null;
  const raw = await env.POINTERS.get(`sso/session/${hex(await sha256(token))}`);
  if (!raw) return null;
  try { const s = JSON.parse(raw); return s.expires_at > new Date().toISOString() ? s : null; } catch { return null; }
}

export const sso = createSsoRoutes();
