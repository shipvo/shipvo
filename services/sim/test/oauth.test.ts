import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import worker from "../src/index";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const O = "https://sim.shipvo.dev";

function setup() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../migrations/0001_oauth_clients.sql", import.meta.url), "utf8"));
  sql.exec(readFileSync(new URL("../migrations/0002_oauth_codes.sql", import.meta.url), "utf8"));
  sql.exec("CREATE TABLE api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id, key_hash, prefix, scope, label, expires_at, revoked_at, account_id, last_used_at, quota_minutes, used_minutes DEFAULT 0)");
  sql.exec("CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, github_id INTEGER UNIQUE, github_login, last_login_at)");
  sql.exec("CREATE TABLE apps (app_id, account_id, listed, approved, latest_release)");
  const DB = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; }, batch: async (l: any[]) => { const r = []; for (const x of l) r.push(await x.run()); return r; } } as any;
  return { sql, env: { DB, CONTROL: "x", GITHUB_CLIENT_ID: "gh-id", GITHUB_CLIENT_SECRET: "gh-secret" } as any };
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

/* ---------- authorize and token ---------- */
const REDIR = "http://localhost:3000/cb";
const b64u = (b: ArrayBuffer) => Buffer.from(b).toString("base64url");
const VERIFIER = "v".repeat(50);
const challengeOf = async (v: string) => b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));

// GitHub stub: code "gh-ok" becomes a token for user 42.
function stubGitHub() {
  vi.stubGlobal("fetch", async (input: any, init?: any) => {
    const u = String(input?.url ?? input);
    if (u === "https://github.com/login/oauth/access_token") { const b = JSON.parse(init.body); return Response.json(b.code === "gh-ok" && b.client_secret === "gh-secret" ? { access_token: "gho_x" } : { error: "bad_verification_code" }); }
    if (u === "https://api.github.com/user") return Response.json(init.headers.authorization === "Bearer gho_x" ? { id: 42, login: "octo" } : {});
    throw new Error("unexpected fetch " + u);
  });
}
afterEach(() => vi.unstubAllGlobals());

async function register(env: any) { return ((await (await post(env, "/register", { redirect_uris: [REDIR] })).json()) as any).client_id as string; }
async function startAuthorize(env: any, client_id: string, over: Record<string, string> = {}) {
  const q = new URLSearchParams({ response_type: "code", client_id, redirect_uri: REDIR, code_challenge: await challengeOf(VERIFIER), code_challenge_method: "S256", state: "xyz", ...over });
  return call(env, "/authorize?" + q, { redirect: "manual" });
}
/** Runs authorize and the GitHub callback; returns the redirect back to the client. */
async function signIn(env: any, client_id: string, ghCode = "gh-ok") {
  const a = await startAuthorize(env, client_id);
  expect(a.status).toBe(302);
  const gh = new URL(a.headers.get("location")!);
  expect(gh.origin + gh.pathname).toBe("https://github.com/login/oauth/authorize");
  expect(gh.searchParams.get("redirect_uri")).toBe(O + "/authorize/callback");
  const cb = await call(env, `/authorize/callback?code=${ghCode}&state=${gh.searchParams.get("state")}`, { redirect: "manual" });
  return { cb, loc: new URL(cb.headers.get("location")!) };
}
const tok = (env: any, client_id: string, code: string, over: Record<string, string> = {}) =>
  call(env, "/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id, code, code_verifier: VERIFIER, redirect_uri: REDIR, ...over }) });

describe("authorize and token", () => {
  it("full PKCE exchange against a GitHub stub, and the token opens a session", async () => {
    stubGitHub(); const { env, sql } = setup(); const cid = await register(env);
    const { loc } = await signIn(env, cid);
    expect(loc.origin + loc.pathname).toBe(REDIR); expect(loc.searchParams.get("state")).toBe("xyz");
    const r = await tok(env, cid, loc.searchParams.get("code")!);
    expect(r.status).toBe(200);
    const t: any = await r.json();
    expect(t.token_type).toBe("Bearer"); expect(t.access_token).toMatch(/^sv_test_/); expect(t.expires_in).toBe(30 * 86400);
    const row = sql.prepare("SELECT * FROM api_keys").get();
    expect(row.key_hash).not.toBe(t.access_token); expect(row.key_hash).toHaveLength(64);
    expect(row.account_id).toBe(sql.prepare("SELECT id FROM accounts WHERE github_login='octo'").get().id);
    expect(row.expires_at > new Date().toISOString()).toBe(true);
    // The key passes the same check as an API key: it reaches the backend check (503 here, no backend configured), not a 401.
    const s = await rpc(env, "tools/call", { authorization: "Bearer " + t.access_token });
    expect(s.status).toBe(503);
  });
  it("refuses a wrong verifier", async () => {
    stubGitHub(); const { env } = setup(); const cid = await register(env);
    const { loc } = await signIn(env, cid);
    const r = await tok(env, cid, loc.searchParams.get("code")!, { code_verifier: "w".repeat(50) });
    expect(r.status).toBe(400); expect(((await r.json()) as any).error).toBe("invalid_grant");
  });
  it("refuses a reused code and revokes the key it made", async () => {
    stubGitHub(); const { env, sql } = setup(); const cid = await register(env);
    const code = (await signIn(env, cid)).loc.searchParams.get("code")!;
    const t: any = await (await tok(env, cid, code)).json();
    const again = await tok(env, cid, code);
    expect(again.status).toBe(400); expect(((await again.json()) as any).error).toBe("invalid_grant");
    expect(sql.prepare("SELECT revoked_at FROM api_keys").get().revoked_at).not.toBeNull();
    expect((await rpc(env, "tools/call", { authorization: "Bearer " + t.access_token })).status).toBe(401);
  });
  it("refuses an expired code", async () => {
    stubGitHub(); const { env, sql } = setup(); const cid = await register(env);
    const code = (await signIn(env, cid)).loc.searchParams.get("code")!;
    sql.exec("UPDATE oauth_codes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE kind = 'code'");
    const r = await tok(env, cid, code);
    expect(r.status).toBe(400); expect(((await r.json()) as any).error).toBe("invalid_grant");
    expect(sql.prepare("SELECT COUNT(*) n FROM api_keys").get().n).toBe(0);
  });
  it("refuses an unregistered redirect without redirecting", async () => {
    stubGitHub(); const { env, sql } = setup(); const cid = await register(env);
    const r = await startAuthorize(env, cid, { redirect_uri: "https://evil.example/cb" });
    expect(r.status).toBe(400); expect(r.headers.get("location")).toBeNull();
    expect((await startAuthorize(env, "shipvo_nope")).status).toBe(400);
    expect(sql.prepare("SELECT COUNT(*) n FROM oauth_codes").get().n).toBe(0);
  });
  it("requires PKCE S256", async () => {
    stubGitHub(); const { env } = setup(); const cid = await register(env);
    for (const over of [{ code_challenge_method: "plain" }, { code_challenge: "" }, { response_type: "token" }]) {
      const r = await startAuthorize(env, cid, over); expect(r.status).toBe(302);
      expect(new URL(r.headers.get("location")!).searchParams.get("error")).toBeTruthy();
      expect(r.headers.get("location")).toContain(REDIR);
    }
    const noMethod = new URLSearchParams({ response_type: "code", client_id: cid, redirect_uri: REDIR, code_challenge: await challengeOf(VERIFIER) });
    expect(new URL((await call(env, "/authorize?" + noMethod, { redirect: "manual" })).headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
  });
  it("refuses a code used with another client or redirect", async () => {
    stubGitHub(); const { env } = setup(); const cid = await register(env); const other = await register(env);
    const code = (await signIn(env, cid)).loc.searchParams.get("code")!;
    expect((await tok(env, other, code)).status).toBe(400);
    const code2 = (await signIn(env, cid)).loc.searchParams.get("code")!;
    expect((await tok(env, cid, code2, { redirect_uri: "http://localhost:3000/other" })).status).toBe(400);
  });
  it("denied GitHub sign-in returns access_denied and no code; the state link is single use", async () => {
    stubGitHub(); const { env } = setup(); const cid = await register(env);
    const { loc } = await signIn(env, cid, "gh-bad");
    expect(loc.searchParams.get("error")).toBe("access_denied"); expect(loc.searchParams.get("code")).toBeNull();
    const a = await startAuthorize(env, cid); const st = new URL(a.headers.get("location")!).searchParams.get("state");
    await call(env, `/authorize/callback?code=gh-ok&state=${st}`, { redirect: "manual" });
    expect((await call(env, `/authorize/callback?code=gh-ok&state=${st}`, { redirect: "manual" })).status).toBe(400);
  });
  it("a new sign-in replaces the account's earlier test key, even from another client", async () => {
    stubGitHub(); const { env, sql } = setup(); const c1 = await register(env); const c2 = await register(env);
    const t1: any = await (await tok(env, c1, (await signIn(env, c1)).loc.searchParams.get("code")!)).json();
    const t2: any = await (await tok(env, c2, (await signIn(env, c2)).loc.searchParams.get("code")!)).json();
    expect(sql.prepare("SELECT COUNT(*) n FROM api_keys WHERE revoked_at IS NULL").get().n).toBe(1);
    expect((await rpc(env, "tools/call", { authorization: "Bearer " + t1.access_token })).status).toBe(401);
    expect((await rpc(env, "tools/call", { authorization: "Bearer " + t2.access_token })).status).toBe(503);
  });
  it("expired and revoked OAuth tokens are refused", async () => {
    stubGitHub(); const { env, sql } = setup(); const cid = await register(env);
    const t: any = await (await tok(env, cid, (await signIn(env, cid)).loc.searchParams.get("code")!)).json();
    const h = { authorization: "Bearer " + t.access_token };
    sql.exec("UPDATE api_keys SET expires_at = '2000-01-01T00:00:00.000Z'");
    const e = await rpc(env, "tools/call", h); expect(e.status).toBe(401); expect(((await e.json()) as any).error).toBe("expired_api_key");
    sql.exec("UPDATE api_keys SET expires_at = '2999-01-01T00:00:00.000Z', revoked_at = '2026-01-01'");
    const v = await rpc(env, "tools/call", h); expect(v.status).toBe(401); expect(((await v.json()) as any).error).toBe("invalid_api_key");
  });
});
