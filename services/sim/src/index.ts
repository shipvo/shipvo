// sim.shipvo.dev: agents connect here over MCP (Streamable HTTP). The Worker checks the API key against the
// control plane's D1, then routes the MCP session to a phone:
//   - E2B backend (default when E2B_API_KEY is set): one sandbox per MCP session, created on initialize,
//     killed on DELETE or after idle. Perfect isolation, pay per second of use.
//   - Cloudflare Containers backend (wrangler.containers.jsonc): one container per app.
import { Container, getContainer } from "@cloudflare/containers";

type Env = {
  SIM?: DurableObjectNamespace<SimContainer>; DB: D1Database; CONTROL: string; OWNER_TOKEN?: string;
  E2B_API_KEY?: string; E2B_TEMPLATE?: string; E2B_API?: string; E2B_SANDBOX_DOMAIN?: string; SESSION_TIMEOUT_S?: string;
};

export class SimContainer extends Container<Env> {
  defaultPort = 8787; sleepAfter = "15m";
  envVars = { PN_CONTROL: "https://purenative-control.purenative.workers.dev", CONTENT_FROM: "https://purenative-control.purenative.workers.dev", PN_SIM_DIR: "/tmp/pn-ui" };
}

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-expose-headers": "mcp-session-id" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });

class QuotaError extends Error { constructor(public quota: number, public used: number) { super(`quota exhausted: ${used}/${quota} sandbox minutes used`); } }

/* ---------- E2B backend ---------- */
const e2bApi = (env: Env) => (env.E2B_API ?? "https://api.e2b.app").replace(/\/$/, "");
async function e2b(env: Env, method: string, path: string, body?: unknown) {
  const r = await fetch(`${e2bApi(env)}${path}`, { method, headers: { "X-API-Key": env.E2B_API_KEY!, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw new Error(`e2b ${method} ${path}: ${r.status} ${text.slice(0, 200)}`);
  return data;
}
async function newSandbox(env: Env, app: string, scope: string) {
  const timeout = Number(env.SESSION_TIMEOUT_S ?? 1800);
  const d = await e2b(env, "POST", "/sandboxes", { templateID: env.E2B_TEMPLATE ?? "shipvo-sim", timeout, metadata: { app, scope, by: "sim.shipvo.dev" } });
  const id: string = d.sandboxID ?? d.sandboxId; const domain: string = d.domain ?? env.E2B_SANDBOX_DOMAIN ?? "e2b.app";
  const host = `https://8787-${id}.${domain}`;
  // Wait for the simulator and MCP inside to be ready (Chromium boot).
  for (let i = 0; i < 60; i++) { try { const h = await fetch(`${host}/health`); if (h.ok) return { id, host }; } catch {} await new Promise((r) => setTimeout(r, 1000)); }
  throw new Error("sandbox did not become ready");
}
const killSandbox = (env: Env, id: string) => e2b(env, "DELETE", `/sandboxes/${id}`).catch(() => {});
const touchSandbox = (env: Env, id: string) => e2b(env, "POST", `/sandboxes/${id}/timeout`, { timeout: Number(env.SESSION_TIMEOUT_S ?? 1800) }).catch(() => {});

// One sandbox ("phone pool") per API key: clients such as ChatGPT reconnect between tool calls, and the agent's
// simulator sessions must survive that. The sandbox is created on first use and expires after idle time.
async function sandboxForKey(env: Env, keyId: number, app: string, scope: string) {
  const row = await env.DB.prepare("SELECT sandbox_id, sandbox_host FROM sim_sessions WHERE mcp_session = ?").bind(`key:${keyId}`).first<{ sandbox_id: string; sandbox_host: string }>();
  if (row) {
    try { const h = await fetch(`${row.sandbox_host}/health`, { signal: AbortSignal.timeout(4000) }); if (h.ok) { touchSandbox(env, row.sandbox_id); return { id: row.sandbox_id, host: row.sandbox_host }; } } catch {}
    await env.DB.prepare("DELETE FROM sim_sessions WHERE mcp_session = ?").bind(`key:${keyId}`).run();   // expired: make a new one
  }
  // Quota: starting a sandbox costs its lifetime in minutes (it idles out after SESSION_TIMEOUT_S).
  const q = await env.DB.prepare("SELECT quota_minutes, used_minutes FROM api_keys WHERE id = ?").bind(keyId).first<{ quota_minutes: number; used_minutes: number }>();
  const cost = Math.ceil(Number(env.SESSION_TIMEOUT_S ?? 1800) / 60);
  if (q && q.quota_minutes > 0 && q.used_minutes + cost > q.quota_minutes) throw new QuotaError(q.quota_minutes, q.used_minutes);
  const sb = await newSandbox(env, app, scope);
  await env.DB.prepare("UPDATE api_keys SET used_minutes = used_minutes + ? WHERE id = ?").bind(cost, keyId).run();
  await env.DB.prepare("INSERT OR REPLACE INTO sim_sessions (mcp_session, sandbox_id, sandbox_host, app_id, scope) VALUES (?,?,?,?,?)").bind(`key:${keyId}`, sb.id, sb.host, app, scope).run();
  return sb;
}
async function viaE2B(req: Request, env: Env, row: { id: number; app_id: string; scope: string }, headers: Headers): Promise<Response> {
  const target = await sandboxForKey(env, row.id, row.app_id, row.scope);
  const res = await fetch(`${target.host}/mcp`, { method: req.method, headers, body: req.body, redirect: "manual" });
  const h = new Headers(res.headers); for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

/* ---------- Worker ---------- */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS });
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "shipvo-sim", backend: env.E2B_API_KEY ? "e2b" : env.SIM ? "containers" : "none", mcp: "/mcp", docs: "https://github.com/shipvo/shipvo/tree/main/packages/mcp" });
    // /mcp with Authorization: Bearer <key>, or, for clients that cannot send headers (ChatGPT's custom MCP
    // connectors offer only OAuth or none), /mcp/<key> or /mcp?key=<key>.
    const pathKey = url.pathname.match(/^\/mcp\/([A-Za-z0-9_-]{8,})$/)?.[1];
    if (url.pathname !== "/mcp" && !pathKey) return json({ error: "not_found" }, 404);

    // API key → app and scope. Keys come from the owner command create_api_key; only hashes are stored.
    const key = ((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()) || pathKey || url.searchParams.get("key") || "";
    if (!key) return json({ error: "missing_api_key", hint: "Authorization: Bearer <key> (create one with the owner command create_api_key)" }, 401);
    const row = await env.DB.prepare("SELECT id, app_id, scope FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL").bind(await sha256(key)).first<{ id: number; app_id: string; scope: string }>();
    if (!row) return json({ error: "invalid_api_key" }, 401);
    env.DB.prepare("UPDATE api_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(row.id).run().catch(() => {});

    const headers = new Headers(req.headers);
    headers.set("x-shipvo-app", row.app_id); headers.set("x-shipvo-scope", row.scope); headers.delete("authorization"); headers.delete("host");
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
