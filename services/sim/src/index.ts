// sim.shipvo.dev: agents connect here over MCP (Streamable HTTP). The Worker checks the API key against the
// control plane's D1, then routes the request to a container that runs the simulator and the MCP server.
import { Container, getContainer } from "@cloudflare/containers";

type Env = { SIM: DurableObjectNamespace<SimContainer>; DB: D1Database; CONTROL: string; OWNER_TOKEN?: string };

export class SimContainer extends Container<Env> {
  defaultPort = 8787;          // MCP over HTTP inside the container
  sleepAfter = "15m";          // scale to zero when no agent has talked for a while
  envVars = { PN_CONTROL: "https://purenative-control.purenative.workers.dev", CONTENT_FROM: "https://purenative-control.purenative.workers.dev", PN_SIM_DIR: "/tmp/pn-ui" };
}

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "mcp-session-id" } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return json("", 204);
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "shipvo-sim", mcp: "/mcp", docs: "https://github.com/shipvo/shipvo/tree/main/packages/mcp" });
    if (url.pathname !== "/mcp") return json({ error: "not_found" }, 404);

    // API key → app and scope. Keys are created with the owner command create_api_key; only hashes are stored.
    const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!key) return json({ error: "missing_api_key", hint: "Authorization: Bearer <key> (create one with the owner command create_api_key)" }, 401);
    const row = await env.DB.prepare("SELECT id, app_id, scope FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL").bind(await sha256(key)).first<{ id: number; app_id: string; scope: string }>();
    if (!row) return json({ error: "invalid_api_key" }, 401);
    env.DB.prepare("UPDATE api_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(row.id).run().catch(() => {});

    // One container per app for now (sessions are isolated inside it); the key's app and scope travel as headers.
    const container = getContainer(env.SIM, `app:${row.app_id}`);
    const headers = new Headers(req.headers);
    headers.set("x-shipvo-app", row.app_id); headers.set("x-shipvo-scope", row.scope); headers.delete("authorization");
    if (row.scope === "owner" && env.OWNER_TOKEN) headers.set("x-shipvo-owner-token", env.OWNER_TOKEN); else headers.delete("x-shipvo-owner-token");
    const res = await container.fetch(new Request(req.url, { method: req.method, headers, body: req.body, redirect: "manual" }));
    const h = new Headers(res.headers); h.set("access-control-allow-origin", "*"); h.set("access-control-expose-headers", "mcp-session-id");
    return new Response(res.body, { status: res.status, headers: h });
  },
};
