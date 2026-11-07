// OAuth for the hosted MCP server (MCP authorization spec): authorization server metadata, dynamic client
// registration, authorization code + PKCE (S256), backed by the GitHub sign-in. The access token is the same
// per-account scoped key that `shipvo login` issues (hash stored, 30-day expiry, revocable), so sim.shipvo.dev
// needs no second kind of credential. Pending state lives in KV with a TTL and codes are single use.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { hit } from "./ratelimit";
import { issueLoginKey, type AuthEnv } from "./auth";

type Env = AuthEnv & { POINTERS: KVNamespace; GITHUB_CLIENT_SECRET?: string; PUBLIC_URL?: string };
export const oauth = new Hono<{ Bindings: Env }>();
const open = cors({ origin: "*", allowHeaders: ["*"], exposeHeaders: ["www-authenticate"] });
oauth.use("/oauth/*", open); oauth.use("/.well-known/oauth-authorization-server", open);

const MAX_URI = 2048, REGISTER_LIMITS = { perIp: 20, perInstall: 0, perApp: 0, windowSeconds: 3600 };
const CLIENT_TTL = 365 * 86400, PENDING_TTL = 600, CODE_TTL = 300;
const rand = (n = 24) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const issuer = (c: { env: Env; req: { url: string } }) => (c.env.PUBLIC_URL ?? new URL(c.req.url).origin).replace(/\/$/, "");
const take = async (kv: KVNamespace, key: string) => { const v = await kv.get(key); if (v) await kv.delete(key); return v ? JSON.parse(v) : null; };
const err = (c: any, error: string, description: string, status = 400) => c.json({ error, error_description: description }, status);

export function metadata(base: string) {
  return {
    issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`, registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["mcp"],
  };
}
oauth.get("/.well-known/oauth-authorization-server", (c) => c.json(metadata(issuer(c))));

/** Dynamic client registration (RFC 7591) for public clients. Redirect URIs must be https, or http on loopback. */
oauth.post("/oauth/register", async (c) => {
  const wait = await hit(c.env.POINTERS, "oauth_register", REGISTER_LIMITS, "ip", c.req.header("cf-connecting-ip") ?? "unknown");
  if (wait) return c.json({ error: "rate_limited", error_description: "Too many registrations. Try again later." }, 429, { "retry-after": String(wait) });
  const b = (await c.req.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null;
  const uris = Array.isArray(b?.redirect_uris) ? (b!.redirect_uris as unknown[]).filter((u): u is string => typeof u === "string") : [];
  const ok = (u: string) => { if (u.length > MAX_URI) return false; try { const x = new URL(u); return !x.hash && (x.protocol === "https:" || (x.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname)) || (/^[a-z][a-z0-9+.-]*:$/.test(x.protocol) && !["http:", "javascript:", "data:"].includes(x.protocol))); } catch { return false; } };
  if (!uris.length || uris.length > 10 || !uris.every(ok)) return err(c, "invalid_redirect_uri", "redirect_uris must be 1 to 10 https, loopback or app-scheme URLs of at most 2048 characters");
  const client_id = `svc_${rand(18)}`;
  const name = typeof b?.client_name === "string" ? b.client_name.slice(0, 80) : "";
  await c.env.POINTERS.put(`oauth:client:${client_id}`, JSON.stringify({ redirect_uris: uris, name }), { expirationTtl: CLIENT_TTL });
  return c.json({ client_id, client_name: name, redirect_uris: uris, grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none" }, 201);
});

/** Send the person to GitHub. We keep the client's request under a one-time state value. */
oauth.get("/oauth/authorize", async (c) => {
  const q = c.req.query();
  const client = q.client_id ? await c.env.POINTERS.get(`oauth:client:${q.client_id}`).then((v) => (v ? JSON.parse(v) : null)) : null;
  // Until client and redirect URI are known good, never redirect to the given URI.
  if (!client) return err(c, "invalid_client", "unknown client_id");
  if (!q.redirect_uri || !client.redirect_uris.includes(q.redirect_uri)) return err(c, "invalid_request", "redirect_uri is not registered");
  const back = (error: string, d: string) => { const u = new URL(q.redirect_uri); u.searchParams.set("error", error); u.searchParams.set("error_description", d); if (q.state) u.searchParams.set("state", q.state); return c.redirect(u.toString(), 302); };
  if (q.response_type !== "code") return back("unsupported_response_type", "response_type must be code");
  if (!q.code_challenge || q.code_challenge_method !== "S256") return back("invalid_request", "PKCE with code_challenge_method=S256 is required");
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) return back("temporarily_unavailable", "sign-in is not configured on this server");
  const gstate = rand(), bind = rand();
  // The cookie ties this sign-in to the browser that started it, so a victim cannot be handed someone else's flow.
  setCookie(c, "shipvo_oauth", bind, { httpOnly: true, secure: true, sameSite: "Lax", path: "/oauth", maxAge: PENDING_TTL });
  await c.env.POINTERS.put(`oauth:pending:${gstate}`, JSON.stringify({ bind, client_id: q.client_id, redirect_uri: q.redirect_uri, state: q.state ?? "", challenge: q.code_challenge }), { expirationTtl: PENDING_TTL });
  const g = new URL("https://github.com/login/oauth/authorize");
  g.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID); g.searchParams.set("redirect_uri", `${issuer(c)}/oauth/callback`);
  g.searchParams.set("scope", "read:user"); g.searchParams.set("state", gstate);
  return c.redirect(g.toString(), 302);
});

/** GitHub sends the person back here. We create or find the account and hand the client a one-time code. */
oauth.get("/oauth/callback", async (c) => {
  const pending = c.req.query("state") ? await take(c.env.POINTERS, `oauth:pending:${c.req.query("state")}`) : null;
  if (!pending) return err(c, "invalid_request", "unknown or expired sign-in; start again from your agent");
  if (getCookie(c, "shipvo_oauth") !== pending.bind) return err(c, "invalid_request", "this sign-in was started in another browser; start again from your agent");
  const back = (error: string, d: string) => { const u = new URL(pending.redirect_uri); u.searchParams.set("error", error); u.searchParams.set("error_description", d); if (pending.state) u.searchParams.set("state", pending.state); return c.redirect(u.toString(), 302); };
  const code = c.req.query("code");
  if (!code) return back("access_denied", "GitHub sign-in was not completed");
  const t: any = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "user-agent": "shipvo-control" }, body: JSON.stringify({ client_id: c.env.GITHUB_CLIENT_ID, client_secret: c.env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${issuer(c)}/oauth/callback` }) }).then((r) => r.json()).catch(() => null);
  if (!t?.access_token) return back("access_denied", "GitHub did not accept the sign-in");
  const u: any = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${t.access_token}`, "user-agent": "shipvo-control", accept: "application/json" } }).then((r) => r.json()).catch(() => null);
  if (!u?.id) return back("server_error", "could not read the GitHub account");
  await c.env.DB.prepare("INSERT INTO accounts (github_id, github_login, last_login_at) VALUES (?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(github_id) DO UPDATE SET github_login = excluded.github_login, last_login_at = excluded.last_login_at").bind(u.id, u.login).run();
  const acct = await c.env.DB.prepare("SELECT id FROM accounts WHERE github_id = ?").bind(u.id).first<{ id: number }>();
  if (!acct) return back("server_error", "could not create the account");
  // No code yet: the person must approve this client first.
  const consent = rand();
  await c.env.POINTERS.put(`oauth:consent:${consent}`, JSON.stringify({ bind: pending.bind, account_id: acct.id, login: u.login, client_id: pending.client_id, redirect_uri: pending.redirect_uri, state: pending.state, challenge: pending.challenge }), { expirationTtl: PENDING_TTL });
  const client = await c.env.POINTERS.get(`oauth:client:${pending.client_id}`).then((v) => (v ? JSON.parse(v) : { name: "" }));
  const esc = (x: string) => x.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const host = new URL(pending.redirect_uri);
  const who = client.name ? esc(client.name) : "An app";
  c.header("cache-control", "no-store"); c.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  return c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Allow access to Shipvo</title><style>body{font:16px system-ui;max-width:28rem;margin:3rem auto;padding:0 1rem}button{font:inherit;padding:.5rem 1rem;margin-right:.5rem}</style><h1>Allow access?</h1><p><b>${who}</b> wants to open the Shipvo simulator as <b>${esc(u.login)}</b>.</p><p>It will send you back to <b>${esc(host.protocol === "https:" || host.protocol === "http:" ? host.host : host.protocol)}</b>. Only allow this if you started it.</p><form method="post" action="/oauth/consent"><input type="hidden" name="id" value="${esc(consent)}"><button name="decision" value="allow">Allow</button><button name="decision" value="deny">Deny</button></form>`);
});

/** The person's answer. The record is single use and only works in the browser that started the flow. */
oauth.post("/oauth/consent", async (c) => {
  const f = Object.fromEntries(new URLSearchParams(await c.req.text()));
  const rec = f.id ? await take(c.env.POINTERS, `oauth:consent:${f.id}`) : null;
  if (!rec || getCookie(c, "shipvo_oauth") !== rec.bind) return err(c, "invalid_request", "unknown, expired or foreign approval; start again from your agent");
  deleteCookie(c, "shipvo_oauth", { path: "/oauth" });
  const r = new URL(rec.redirect_uri);
  if (f.decision !== "allow") { r.searchParams.set("error", "access_denied"); r.searchParams.set("error_description", "the person denied access"); }
  else {
    const ours = rand(32);
    await c.env.POINTERS.put(`oauth:code:${ours}`, JSON.stringify({ account_id: rec.account_id, login: rec.login, client_id: rec.client_id, redirect_uri: rec.redirect_uri, challenge: rec.challenge }), { expirationTtl: CODE_TTL });
    r.searchParams.set("code", ours);
  }
  if (rec.state) r.searchParams.set("state", rec.state);
  return c.redirect(r.toString(), 302);
});

/** Exchange the code (with the PKCE verifier) for the account's scoped key. The code works once. */
oauth.post("/oauth/token", async (c) => {
  const ct = c.req.header("content-type") ?? "";
  const f: Record<string, string> = ct.includes("json") ? await c.req.json().catch(() => ({})) : Object.fromEntries(new URLSearchParams(await c.req.text()));
  if (f.grant_type !== "authorization_code") return err(c, "unsupported_grant_type", "only authorization_code is supported");
  const rec = f.code ? await take(c.env.POINTERS, `oauth:code:${f.code}`) : null;
  if (!rec) return err(c, "invalid_grant", "the code is unknown, expired or already used");
  if (rec.client_id !== f.client_id || rec.redirect_uri !== f.redirect_uri) return err(c, "invalid_grant", "client or redirect_uri does not match the request");
  const verifier = f.code_verifier ?? "";
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))) !== rec.challenge) return err(c, "invalid_grant", "PKCE verification failed");
  const k = await issueLoginKey(c.env, rec.account_id, rec.login, "oauth", rec.client_id);
  c.header("cache-control", "no-store");
  return c.json({ access_token: k.key, token_type: "Bearer", expires_in: Math.max(1, Math.floor((Date.parse(k.expires_at) - Date.now()) / 1000)) });
});
