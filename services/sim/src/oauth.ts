// OAuth discovery and dynamic client registration for the hosted MCP (MCP authorization spec).
// Also /authorize (GitHub sign-in, PKCE S256) and /token, which issues the same per-account key the API uses.
type Db = { DB: D1Database; GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; GITHUB_WEB?: string; GITHUB_API?: string };

const PENDING_TTL_MS = 10 * 60_000;   // time to finish signing in at GitHub
const CODE_TTL_MS = 5 * 60_000;       // life of an authorization code
const KEY_TTL_DAYS = 30;
const QUOTA_MIN = 600;
const BETA_APP = "tide";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-expose-headers": "mcp-session-id" };
const json = (o: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...extra } });

export const GRANT_TYPES = ["authorization_code", "refresh_token"];
const MAX_REDIRECTS = 10;

export const resourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource`;
/** Value of the WWW-Authenticate header on a 401, pointing clients at the metadata. */
export const wwwAuthenticate = (origin: string) => `Bearer resource_metadata="${resourceMetadataUrl(origin)}"`;

export const protectedResourceMetadata = (origin: string) => ({
  resource: `${origin}/mcp`,
  authorization_servers: [origin],
  bearer_methods_supported: ["header"],
  resource_name: "Shipvo hosted simulator",
});

export const authorizationServerMetadata = (origin: string) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/authorize`,
  token_endpoint: `${origin}/token`,
  registration_endpoint: `${origin}/register`,
  response_types_supported: ["code"],
  grant_types_supported: GRANT_TYPES,
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
});

/** https is allowed anywhere; http only for loopback. No fragments. */
export function validRedirectUri(s: unknown): boolean {
  if (typeof s !== "string" || s.length > 2000) return false;
  let u: URL; try { u = new URL(s); } catch { return false; }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
}

const regError = (error: string, description: string) => json({ error, error_description: description }, 400);

async function register(req: Request, env: Db): Promise<Response> {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return regError("invalid_client_metadata", "Body must be a JSON object.");
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECTS) return regError("invalid_redirect_uri", `redirect_uris must list 1 to ${MAX_REDIRECTS} URIs.`);
  if (!uris.every(validRedirectUri)) return regError("invalid_redirect_uri", "Redirect URIs must use https, or http on localhost, 127.0.0.1 or [::1], with no fragment.");
  const grants = body.grant_types === undefined ? GRANT_TYPES : body.grant_types;
  if (!Array.isArray(grants) || grants.length === 0 || !grants.every((g) => typeof g === "string" && GRANT_TYPES.includes(g))) return regError("invalid_client_metadata", `grant_types must be from: ${GRANT_TYPES.join(", ")}.`);
  const method = body.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") return regError("invalid_client_metadata", "token_endpoint_auth_method must be none (public clients with PKCE).");
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 100) : null;
  const clientId = `shipvo_${crypto.randomUUID().replace(/-/g, "")}`;
  await env.DB.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, grant_types) VALUES (?,?,?,?)").bind(clientId, name, JSON.stringify(uris), JSON.stringify(grants)).run();
  return json({
    client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), ...(name ? { client_name: name } : {}),
    redirect_uris: uris, grant_types: grants, response_types: ["code"], token_endpoint_auth_method: "none",
  }, 201);
}

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const rand = (n = 24) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
const iso = (ms: number) => new Date(ms).toISOString();
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

type Client = { client_id: string; redirect_uris: string };
const getClient = (env: Db, id: string | null) => id ? env.DB.prepare("SELECT client_id, redirect_uris FROM oauth_clients WHERE client_id = ?").bind(id).first<Client>() : Promise.resolve(null);
const page = (status: number, msg: string) => new Response(`<!doctype html><meta charset="utf-8"><title>Shipvo sign in</title><p>${msg}</p>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const back = (uri: string, params: Record<string, string | null>) => {
  const u = new URL(uri); for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { location: u.toString(), "cache-control": "no-store" } });
};

async function authorize(req: Request, env: Db): Promise<Response> {
  const url = new URL(req.url); const q = url.searchParams;
  const client = await getClient(env, q.get("client_id"));
  const redirect = q.get("redirect_uri");
  // Unknown client or unregistered redirect: never redirect, show the error here.
  if (!client) return page(400, "Unknown client_id.");
  if (!redirect || !(JSON.parse(client.redirect_uris) as string[]).includes(redirect)) return page(400, "redirect_uri is not registered for this client.");
  const state = q.get("state");
  const fail = (error: string) => back(redirect, { error, state });
  if (q.get("response_type") !== "code") return fail("unsupported_response_type");
  const challenge = q.get("code_challenge");
  if (!challenge || q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return fail("invalid_request");
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return fail("temporarily_unavailable");
  const pending = rand();
  await env.DB.prepare("INSERT INTO oauth_codes (hash, kind, client_id, redirect_uri, code_challenge, client_state, expires_at) VALUES (?,?,?,?,?,?,?)")
    .bind(await sha256(pending), "pending", client.client_id, redirect, challenge, state, iso(Date.now() + PENDING_TTL_MS)).run();
  const gh = new URL(`${(env.GITHUB_WEB ?? "https://github.com").replace(/\/$/, "")}/login/oauth/authorize`);
  gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID); gh.searchParams.set("scope", "read:user");
  gh.searchParams.set("state", pending); gh.searchParams.set("redirect_uri", `${url.origin}/authorize/callback`);
  return new Response(null, { status: 302, headers: { location: gh.toString(), "cache-control": "no-store" } });
}

/** GitHub sends the person back here; we find who they are and hand the agent client a code. */
async function callback(req: Request, env: Db): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const h = await sha256(q.get("state") ?? "");
  const row = await env.DB.prepare("SELECT * FROM oauth_codes WHERE hash = ? AND kind = 'pending'").bind(h).first<any>();
  if (!row) return page(400, "This sign-in link is unknown or was already used. Start again from your assistant.");
  const claimed = await env.DB.prepare("DELETE FROM oauth_codes WHERE hash = ? AND kind = 'pending'").bind(h).run();
  if (claimed.meta?.changes === 0) return page(400, "This sign-in link was already used. Start again from your assistant.");
  if (row.expires_at < new Date().toISOString()) return page(400, "This sign-in link expired. Start again from your assistant.");
  const fail = (error: string) => back(row.redirect_uri, { error, state: row.client_state });
  if (q.get("error") || !q.get("code")) return fail("access_denied");
  const web = (env.GITHUB_WEB ?? "https://github.com").replace(/\/$/, ""); const api = (env.GITHUB_API ?? "https://api.github.com").replace(/\/$/, "");
  const ghHeaders = { accept: "application/json", "content-type": "application/json", "user-agent": "shipvo-sim" };
  let login: string, ghId: number;
  try {
    const t: any = await (await fetch(`${web}/login/oauth/access_token`, { method: "POST", headers: ghHeaders, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: q.get("code") }) })).json();
    if (!t?.access_token) return fail("access_denied");
    const u: any = await (await fetch(`${api}/user`, { headers: { ...ghHeaders, authorization: `Bearer ${t.access_token}` } })).json();
    if (!u?.id) return fail("server_error");
    login = u.login; ghId = u.id;
  } catch { return fail("server_error"); }
  await env.DB.prepare(`INSERT INTO accounts (github_id, github_login, last_login_at) VALUES (?,?,${NOW}) ON CONFLICT(github_id) DO UPDATE SET github_login = excluded.github_login, last_login_at = excluded.last_login_at`).bind(ghId, login).run();
  const acct = (await env.DB.prepare("SELECT id FROM accounts WHERE github_id = ?").bind(ghId).first<{ id: number }>())!;
  const code = rand(32);
  await env.DB.prepare("INSERT INTO oauth_codes (hash, kind, client_id, redirect_uri, code_challenge, client_state, account_id, expires_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(await sha256(code), "code", row.client_id, row.redirect_uri, row.code_challenge, row.client_state, acct.id, iso(Date.now() + CODE_TTL_MS)).run();
  return back(row.redirect_uri, { code, state: row.client_state });
}

const tokenError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status);

async function token(req: Request, env: Db): Promise<Response> {
  const ct = req.headers.get("content-type") ?? "";
  let f: URLSearchParams;
  if (ct.includes("application/json")) { const b = await req.json().catch(() => null) as Record<string, unknown> | null; f = new URLSearchParams(Object.entries(b ?? {}).filter(([, v]) => typeof v === "string") as [string, string][]); }
  else f = new URLSearchParams(await req.text());
  if (f.get("grant_type") !== "authorization_code") return tokenError("unsupported_grant_type", "Only authorization_code is supported.");
  const code = f.get("code"); const verifier = f.get("code_verifier");
  if (!code || !verifier) return tokenError("invalid_request", "code and code_verifier are required.");
  const h = await sha256(code);
  const row = await env.DB.prepare("SELECT * FROM oauth_codes WHERE hash = ? AND kind = 'code'").bind(h).first<any>();
  if (!row) return tokenError("invalid_grant", "Unknown code.");
  // Claim first: the code is spent by any attempt, so a guessed verifier gets one try.
  const claim = await env.DB.prepare(`UPDATE oauth_codes SET used_at = ${NOW} WHERE hash = ? AND used_at IS NULL`).bind(h).run();
  if (claim.meta?.changes === 0) {
    // A reused code: take back the key it produced.
    if (row.key_id) await env.DB.prepare(`UPDATE api_keys SET revoked_at = ${NOW} WHERE id = ? AND revoked_at IS NULL`).bind(row.key_id).run();
    return tokenError("invalid_grant", "Code was already used.");
  }
  if (row.expires_at < new Date().toISOString()) return tokenError("invalid_grant", "Code expired.");
  if (f.get("client_id") !== row.client_id) return tokenError("invalid_grant", "Code was issued to a different client.");
  if (f.get("redirect_uri") !== row.redirect_uri) return tokenError("invalid_grant", "redirect_uri does not match the authorization request.");
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))) !== row.code_challenge) return tokenError("invalid_grant", "PKCE verification failed.");
  // Same key as `shipvo login`: sv_test_…, hash stored, 30 days, same quota, revocable. A new sign-in from this client replaces its earlier key.
  const key = `sv_test_${rand(24).replace(/[-_]/g, "a")}`;
  const label = `shipvo oauth (${row.client_id})`;
  await env.DB.prepare(`UPDATE api_keys SET revoked_at = ${NOW} WHERE account_id = ? AND label = ? AND revoked_at IS NULL`).bind(row.account_id, label).run();
  const expires = iso(Date.now() + KEY_TTL_DAYS * 86400_000);
  await env.DB.prepare("INSERT INTO api_keys (app_id, key_hash, prefix, scope, label, account_id, quota_minutes, expires_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(BETA_APP, await sha256(key), key.slice(0, 12), "test", label, row.account_id, QUOTA_MIN, expires).run();
  const made = await env.DB.prepare("SELECT id FROM api_keys WHERE key_hash = ?").bind(await sha256(key)).first<{ id: number }>();
  if (made) await env.DB.prepare("UPDATE oauth_codes SET key_id = ? WHERE hash = ?").bind(made.id, h).run();
  return json({ access_token: key, token_type: "Bearer", expires_in: KEY_TTL_DAYS * 86400, scope: "test" });
}

/** Handles the discovery and registration routes. Returns null for any other path. */
export async function handleOAuth(req: Request, env: Db): Promise<Response | null> {
  const url = new URL(req.url); const p = url.pathname; const origin = url.origin;
  if (p === "/.well-known/oauth-protected-resource" || p === "/.well-known/oauth-protected-resource/mcp") {
    return req.method === "GET" ? json(protectedResourceMetadata(origin)) : json({ error: "method_not_allowed" }, 405);
  }
  if (p === "/.well-known/oauth-authorization-server") {
    return req.method === "GET" ? json(authorizationServerMetadata(origin)) : json({ error: "method_not_allowed" }, 405);
  }
  if (p === "/register") return req.method === "POST" ? register(req, env) : json({ error: "method_not_allowed" }, 405);
  if (p === "/authorize") return req.method === "GET" ? authorize(req, env) : json({ error: "method_not_allowed" }, 405);
  if (p === "/authorize/callback") return req.method === "GET" ? callback(req, env) : json({ error: "method_not_allowed" }, 405);
  if (p === "/token") return req.method === "POST" ? token(req, env) : json({ error: "method_not_allowed" }, 405);
  return null;
}
