// sim.shipvo.dev: agents connect here over MCP (Streamable HTTP). The Worker checks the API key against the
// control plane's D1, then routes the MCP session to a phone:
//   - E2B backend (default when E2B_API_KEY is set): one sandbox per MCP session, created on initialize,
//     killed on DELETE or after idle. Perfect isolation, pay per second of use.
//   - Cloudflare Containers backend (wrangler.containers.jsonc): one container per app.
import { sandboxForKey, existingHost, QuotaError } from "./phones";
import { Container, getContainer } from "@cloudflare/containers";
import TOOLS from "./tools.json";
import RESOURCES from "./resources.json";
import WIDGETS from "./widgets.json";
import { handleOAuth, wwwAuthenticate } from "./oauth";
import { negotiateProtocolHeader } from "./protocol";
import { handleWatch, addWatchUrl, watchUrl } from "./watch";

type Env = {
  SIM?: DurableObjectNamespace<SimContainer>; DB: D1Database; CONTROL: string; OWNER_TOKEN?: string;
  SIM_REV?: string; E2B_API_KEY?: string; E2B_TEMPLATE?: string; E2B_API?: string; E2B_SANDBOX_DOMAIN?: string; SESSION_TIMEOUT_S?: string;
  WATCH_SECRET?: string; GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; GITHUB_WEB?: string; GITHUB_API?: string;
};

export class SimContainer extends Container<Env> {
  defaultPort = 8787; sleepAfter = "15m";
  envVars = { PN_CONTROL: "https://api.shipvo.dev", CONTENT_FROM: "https://api.shipvo.dev", PN_SIM_DIR: "/tmp/pn-ui" };
}

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-expose-headers": "mcp-session-id" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });

/* ---------- E2B backend: see phones.ts ---------- */
async function viaE2B(req: Request, env: Env, row: { id: number; app_id: string; scope: string }, headers: Headers): Promise<Response> {
  const target = await sandboxForKey(env, row.id, row.app_id, row.scope);
  const reqText = req.method === "POST" ? await req.clone().text() : "";
  const res = await fetch(`${target.host}/mcp`, { method: req.method, headers, body: req.body, redirect: "manual" });
  const h = new Headers(res.headers); for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return decorate(req, env, row.id, new Response(res.body, { status: res.status, headers: h }), reqText);
}
// open_app results carry the watch link. The Worker signs it, so the sandbox never holds the secret.
async function decorate(req: Request, env: Env, keyId: number, res: Response, reqText: string): Promise<Response> {
  if (!env.WATCH_SECRET || req.method !== "POST" || !/"name"\s*:\s*"open_app"/.test(reqText) || !(res.headers.get("content-type") ?? "").includes("application/json")) return res;
  const body = await addWatchUrl(await res.text(), (s) => watchUrl(new URL(req.url).origin, env.WATCH_SECRET!, s, keyId));
  const h = new Headers(res.headers); h.delete("content-length");
  return new Response(body, { status: res.status, headers: h });
}
// An existing sandbox of a key (never starts one), for the watch page.
async function existingSandbox(env: Env, keyId: number, path: string, init?: RequestInit): Promise<Response> {
  if (env.E2B_API_KEY) {
    const host = await existingHost(env, keyId);
    if (!host) throw new Error("no sandbox");
    return fetch(`${host}${path}`, init);
  }
  const k = await env.DB.prepare("SELECT app_id FROM api_keys WHERE id = ?").bind(keyId).first<{ app_id: string }>();
  if (!env.SIM || !k) throw new Error("no sandbox");
  return getContainer(env.SIM, `app:${k.app_id}`).fetch(new Request(`http://sim${path}`, init));
}

/* ---------- Worker ---------- */
/** Values pasted into the dashboard often carry spaces or a newline at the ends; GitHub rejects such a client ID. */
export function cleanEnv(env: Env): Env {
  return { ...env, GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID?.trim() || undefined, GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET?.trim() || undefined };
}

/** The registered client name of an OAuth key ("ChatGPT", "Gemini"), or null for other keys. */
// Assistants whose sign-in names no client: known by the host they sign in from (a client id URL or a redirect URI).
const ASSISTANT_HOSTS: [RegExp, string][] = [[/(^|\.)(chatgpt\.com|openai\.com)$/, "ChatGPT"], [/(^|\.)(gemini\.google\.com|google\.com|googleapis\.com)$/, "Gemini"], [/(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/, "Claude"]];
function assistantOfUrls(urls: string[]): string | null {
  for (const u of urls) { let host = ""; try { host = new URL(u).hostname.toLowerCase(); } catch { continue; } for (const [re, name] of ASSISTANT_HOSTS) if (re.test(host)) return name; }
  return null;
}
export async function clientOfKey(env: Env, keyId: number): Promise<string | null> {
  const k = await env.DB.prepare("SELECT label FROM api_keys WHERE id = ?").bind(keyId).first<{ label: string | null }>();
  const label = k?.label ?? "";
  const now = /^shipvo oauth: (.+)$/.exec(label)?.[1];
  const id = now ? (now.startsWith("shipvo_") || now.startsWith("https://") ? now : null) : /^shipvo oauth \((shipvo_[\w]+)\)$/.exec(label)?.[1] ?? null;   // older keys: "shipvo oauth (<client id>)"
  if (now && !id) return now.slice(0, 64);
  if (!id) return null;
  if (id.startsWith("https://")) return assistantOfUrls([id]);   // a client id metadata URL
  const c = await env.DB.prepare("SELECT client_name, redirect_uris FROM oauth_clients WHERE client_id = ?").bind(id).first<{ client_name: string | null; redirect_uris: string | null }>();
  const named = c?.client_name?.trim().slice(0, 64);
  if (named) return named;
  let uris: string[] = []; try { uris = JSON.parse(c?.redirect_uris ?? "[]"); } catch {}
  return assistantOfUrls(Array.isArray(uris) ? uris : []);
}

export default {
  async fetch(req: Request, rawEnv: Env): Promise<Response> {
    const env = cleanEnv(rawEnv);
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS });
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "shipvo-sim", backend: env.E2B_API_KEY ? "e2b" : env.SIM ? "containers" : "none", mcp: "/mcp", docs: "https://github.com/shipvo/shipvo/tree/main/packages/mcp" });
    const oauth = await handleOAuth(req, env); if (oauth) return oauth;
    const watch = await handleWatch(req, env, (k, p, i) => existingSandbox(env, k, p, i)); if (watch) return watch;
    // /mcp with Authorization: Bearer <key>, or, for clients that cannot send headers (ChatGPT's custom MCP
    // connectors offer only OAuth or none), /mcp/<key> or /mcp?key=<key>.
    // Scripts of the MCP Apps views, for hosts whose page policy blocks inline scripts (ChatGPT). Static and public.
    const widget = req.method === "GET" ? (WIDGETS as Record<string, string>)[url.pathname] : undefined;
    if (widget) return new Response(widget, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
    const pathKey = url.pathname.match(/^\/mcp\/([A-Za-z0-9_-]{8,})$/)?.[1];
    if (url.pathname !== "/mcp" && !pathKey) return json({ error: "not_found" }, 404);

    // API key → app and scope. Keys come from the owner command create_api_key; only hashes are stored.
    const key = ((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()) || pathKey || url.searchParams.get("key") || "";
    // Without a key, answer only the discovery handshake (initialize, ping, tools/list) from a static list, so
    // registries and checkers can verify the server. Nothing here opens a phone, costs a sandbox or touches an app.
    if (!key && req.method === "POST" && url.pathname === "/mcp") {
      const msg = await req.clone().json().catch(() => null) as { jsonrpc?: string; id?: unknown; method?: string; params?: { protocolVersion?: string } } | null;
      if (msg && !Array.isArray(msg) && msg.jsonrpc === "2.0") {
        if (msg.method === "notifications/initialized") return new Response(null, { status: 202, headers: CORS });
        const rpc = (result: unknown) => json({ jsonrpc: "2.0", id: msg.id ?? null, result });
        if (msg.method === "initialize") return rpc({ protocolVersion: msg.params?.protocolVersion ?? "2025-03-26", capabilities: { tools: { listChanged: false }, resources: { listChanged: false } }, serverInfo: { name: "shipvo", version: "0.0.6" }, instructions: "Shipvo lets an assistant use a React Native app in a simulated phone. Tools that open or act on an app need an API key: Authorization: Bearer <key> (run `npx @shipvo/cli login`). https://shipvo.dev/docs/test-with-an-assistant/" });
        if (msg.method === "ping") return rpc({});
        if (msg.method === "tools/list") return rpc({ tools: TOOLS });
        // The MCP Apps pages (such as the live inbox) are static, so hosts can fetch them before signing in.
        if (msg.method === "resources/list") return rpc({ resources: RESOURCES.map(({ contents: _, ...r }) => r) });
        if (msg.method === "resources/read") { const r = RESOURCES.find((x) => x.uri === (msg.params as { uri?: string } | undefined)?.uri); return r ? rpc({ contents: r.contents }) : json({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32002, message: "Resource not found" } }); }
      }
    }
    const challenge = { "www-authenticate": wwwAuthenticate(url.origin) };
    const unauthorized = (o: unknown) => new Response(JSON.stringify(o), { status: 401, headers: { "content-type": "application/json", ...CORS, ...challenge } });
    if (!key) return unauthorized({ error: "missing_api_key", hint: "Authorization: Bearer <key> (create one with the owner command create_api_key)" });
    const row = await env.DB.prepare("SELECT id, app_id, scope, expires_at, account_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL").bind(await sha256(key)).first<{ id: number; app_id: string; scope: string; expires_at: string | null; account_id: number | null }>();
    if (!row) return unauthorized({ error: "invalid_api_key" });
    if (row.expires_at && row.expires_at < new Date().toISOString()) return unauthorized({ error: "expired_api_key", expires_at: row.expires_at, hint: "Run `shipvo login` to get a new key." });
    env.DB.prepare("UPDATE api_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(row.id).run().catch(() => {});

    // A signed-in developer's key opens the beta app plus the apps they registered.
    const owned = row.account_id ? ((await env.DB.prepare("SELECT app_id FROM apps WHERE account_id = ?").bind(row.account_id).all()).results as { app_id: string }[]).map((r) => r.app_id) : [];
    const pub = row.account_id ? ((await env.DB.prepare("SELECT app_id FROM apps WHERE listed = 1 AND approved = 1 AND latest_release IS NOT NULL").all()).results as { app_id: string }[]).map((r) => r.app_id) : [];
    // Activity for the store: an open_app of a public app counts as one agent session (fire and forget).
    if (req.method === "POST" && pub.length) { try { const txt = await req.clone().text(); const m = txt.match(/"name"\s*:\s*"open_app"[\s\S]{0,400}?"app"\s*:\s*"([a-z0-9-]+)/); if (m && pub.includes(m[1])) env.DB.prepare("UPDATE apps SET opens = opens + 1, last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE app_id = ?").bind(m[1]).run().catch(() => {}); } catch {} }
    const headers = new Headers(req.headers);
    headers.set("x-shipvo-app", [...new Set([row.app_id, ...owned, ...pub])].join(","));
    headers.set("x-shipvo-public", pub.join(",")); headers.set("x-shipvo-scope", row.scope); headers.delete("authorization"); headers.delete("host");
    // The verified key, for the build lookup in open_app. Set after the client headers are copied, so a client-sent x-shipvo-key is replaced.
    headers.set("x-shipvo-key", key);
    // The assistant behind an OAuth key, so the phone can say who sent a message even when a request carries no
    // client name (stateless HTTP: the name only arrives with initialize). A client-sent value is never trusted.
    headers.delete("x-shipvo-client");
    const named = await clientOfKey(env, row.id); if (named) headers.set("x-shipvo-client", named);
        negotiateProtocolHeader(headers);   // a client newer than the server (ChatGPT) names a version the SDK would reject with 400
    if (row.scope === "owner" && env.OWNER_TOKEN) headers.set("x-shipvo-owner-token", env.OWNER_TOKEN); else headers.delete("x-shipvo-owner-token");

    try {
      if (env.E2B_API_KEY) return await viaE2B(req, env, row, headers);
      if (env.SIM) {
        const res = await getContainer(env.SIM, `app:${row.app_id}`).fetch(new Request(req.url, { method: req.method, headers, body: req.body, redirect: "manual" }));
        const h = new Headers(res.headers); for (const [k, v] of Object.entries(CORS)) h.set(k, v);
        return new Response(res.body, { status: res.status, headers: h });
      }
      return json({ error: "no_backend", hint: "set E2B_API_KEY (E2B sandboxes) or deploy with wrangler.containers.jsonc" }, 503);
    } catch (e: any) { if (e instanceof QuotaError) return json({ error: "quota_exhausted", message: e.message, quota_minutes: e.quota, used_minutes: e.used }, 429); return json({ error: "backend_error", message: String(e?.message ?? e) }, 502); }
  },
};
