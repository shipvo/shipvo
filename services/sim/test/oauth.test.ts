import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import worker from "../src/index";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const O = "https://sim.shipvo.dev";

function setup() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../migrations/0001_oauth_clients.sql", import.meta.url), "utf8"));
  sql.exec("CREATE TABLE api_keys (id INTEGER PRIMARY KEY, app_id, key_hash, scope, expires_at, revoked_at, account_id, last_used_at)");
  const DB = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
  return { sql, env: { DB, CONTROL: "x" } as any };
}
const call = (env: any, path: string, init?: RequestInit) => worker.fetch(new Request(O + path, init), env);
const post = (env: any, path: string, body: unknown) => call(env, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const rpc = (env: any, method: string, headers: Record<string, string> = {}) => call(env, "/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }) });

describe("metadata", () => {
  it("protected resource", async () => {
    const { env } = setup();
    for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const r = await call(env, p); expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ resource: `${O}/mcp`, authorization_servers: [O] });
    }
  });
  it("authorization server", async () => {
    const { env } = setup();
    const m: any = await (await call(env, "/.well-known/oauth-authorization-server")).json();
    expect(m.issuer).toBe(O);
    expect(m.authorization_endpoint).toBe(`${O}/authorize`);
    expect(m.token_endpoint).toBe(`${O}/token`);
    expect(m.registration_endpoint).toBe(`${O}/register`);
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(m.response_types_supported).toEqual(["code"]);
  });
});

describe("POST /register", () => {
  it("stores the client", async () => {
    const { env, sql } = setup();
    const r = await post(env, "/register", { client_name: "Claude", redirect_uris: ["https://claude.ai/cb", "http://localhost:3000/cb", "http://127.0.0.1:8080/x", "http://[::1]:9/x"] });
    expect(r.status).toBe(201);
    const b: any = await r.json();
    expect(b.client_id).toMatch(/^shipvo_/); expect(b.token_endpoint_auth_method).toBe("none");
    const row = sql.prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(b.client_id);
    expect(JSON.parse(row.redirect_uris)).toHaveLength(4); expect(row.client_name).toBe("Claude");
  });
  it.each([
    ["http non-loopback", ["http://example.com/cb"]], ["custom scheme", ["myapp://cb"]], ["fragment", ["https://a.dev/cb#x"]],
    ["not a url", ["nope"]], ["empty", []], ["not an array", "https://a.dev"], ["http lookalike", ["http://localhost.evil.com/cb"]],
    ["one bad among good", ["https://a.dev/cb", "http://a.dev/cb"]],
  ])("rejects %s", async (_n, uris) => {
    const { env, sql } = setup();
    const r = await post(env, "/register", { redirect_uris: uris });
    expect(r.status).toBe(400); expect(((await r.json()) as any).error).toBe("invalid_redirect_uri");
    expect(sql.prepare("SELECT COUNT(*) n FROM oauth_clients").get().n).toBe(0);
  });
  it("rejects bad grant types, auth method and bodies", async () => {
    const { env } = setup(); const ok = ["https://a.dev/cb"];
    expect((await post(env, "/register", { redirect_uris: ok, grant_types: ["password"] })).status).toBe(400);
    expect((await post(env, "/register", { redirect_uris: ok, token_endpoint_auth_method: "client_secret_basic" })).status).toBe(400);
    expect((await call(env, "/register", { method: "POST", body: "nope" })).status).toBe(400);
    expect((await call(env, "/register")).status).toBe(405);
  });
});

describe("401 challenge", () => {
  const header = `Bearer resource_metadata="${O}/.well-known/oauth-protected-resource"`;
  it("tool call without a key", async () => {
    const { env } = setup();
    const r = await rpc(env, "tools/call");
    expect(r.status).toBe(401); expect(r.headers.get("www-authenticate")).toBe(header);
  });
  it("invalid key carries the header too", async () => {
    const { env } = setup();
    const r = await rpc(env, "tools/call", { authorization: "Bearer nokey12345" });
    expect(r.status).toBe(401); expect(r.headers.get("www-authenticate")).toBe(header);
  });
  it("initialize and tools/list stay open", async () => {
    const { env } = setup();
    for (const m of ["initialize", "tools/list"]) { const r = await rpc(env, m); expect(r.status).toBe(200); expect(r.headers.get("www-authenticate")).toBeNull(); }
  });
  it("a valid key passes the auth check", async () => {
    const { env, sql } = setup();
    const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("goodkey12345")))].map((b) => b.toString(16).padStart(2, "0")).join("");
    sql.prepare("INSERT INTO api_keys (app_id, key_hash, scope) VALUES ('tide', ?, 'app')").run(h);
    const r = await rpc(env, "tools/call", { authorization: "Bearer goodkey12345" });
    expect(r.status).toBe(503);   // past auth; no backend configured in the test
    expect(((await r.json()) as any).error).toBe("no_backend");
  });
});
