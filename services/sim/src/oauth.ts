// OAuth discovery and dynamic client registration for the hosted MCP (MCP authorization spec).
// Authorize and token endpoints come in the next slice; the metadata already names their URLs.
type Db = { DB: D1Database };

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
  return null;
}
