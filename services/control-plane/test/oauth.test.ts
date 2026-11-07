import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("@cloudflare/containers", () => ({ Container: class {}, getContainer: () => ({ fetch: async () => new Response("never") }) }));
import app from "../src/index";
import sim from "../../sim/src/index";

// A tiny in-memory stand-in for KV and for the two D1 tables the sign-in touches.
function world() {
  const kv = new Map<string, string>();
  const keys: any[] = []; const accounts: { id: number; github_id: number; login: string }[] = [];
  const POINTERS = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } };
  const DB = { prepare: (sql: string) => ({ bind: (...a: any[]) => {
    const run = async () => {
      if (/INSERT INTO accounts/.test(sql)) { if (!accounts.find((x) => x.github_id === a[0])) accounts.push({ id: accounts.length + 1, github_id: a[0], login: a[1] }); }
      else if (/INSERT INTO api_keys/.test(sql)) keys.push({ id: keys.length + 1, app_id: a[0], key_hash: a[1], prefix: a[2], scope: a[3], label: a[4], account_id: a[5], expires_at: a[7], revoked_at: null });
      else if (/UPDATE api_keys SET revoked_at/.test(sql)) keys.filter((k) => k.account_id === a[0] && k.scope === "test" && !k.revoked_at && (a.length < 2 || k.label === a[1])).forEach((k) => (k.revoked_at = "now"));
      return {};
    };
    const first = async () => {
      if (/FROM accounts WHERE github_id/.test(sql)) return accounts.find((x) => x.github_id === a[0]) ?? null;
      if (/FROM api_keys WHERE key_hash/.test(sql)) return keys.find((k) => k.key_hash === a[0] && !k.revoked_at) ?? null;
      return null;
    };
    return { run, first, all: async () => ({ results: [] }) };
  } }) };
  return { kv, keys, env: { POINTERS, DB, GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "sec", PUBLIC_URL: "https://api.shipvo.dev" } as any };
}

const verifier = "v".repeat(50);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

async function register(env: any) {
  const r = await app.request("/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "Claude" }), headers: { "content-type": "application/json" } }, env);
  return { r, body: (await r.json()) as any };
}
function stubGithub() {
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: any) => {
    if (u === "https://github.com/login/oauth/access_token") { const b = JSON.parse(init.body); return Response.json(b.code === "ghcode" && b.client_secret === "sec" ? { access_token: "gho_x" } : { error: "bad_verification_code" }); }
    if (u === "https://api.github.com/user") return Response.json({ id: 42, login: "octo" });
    throw new Error("unexpected fetch " + u);
  }));
}
async function signIn(env: any, client_id: string) {
  const a = await app.request(`/oauth/authorize?${new URLSearchParams({ client_id, redirect_uri: REDIRECT, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "st1" })}`, {}, env);
  expect(a.status).toBe(302);
  const g = new URL(a.headers.get("location")!);
  expect(g.origin + g.pathname).toBe("https://github.com/login/oauth/authorize");
  expect(g.searchParams.get("redirect_uri")).toBe("https://api.shipvo.dev/oauth/callback");
  const cb = await app.request(`/oauth/callback?code=ghcode&state=${g.searchParams.get("state")}`, {}, env);
  expect(cb.status).toBe(302);
  const back = new URL(cb.headers.get("location")!);
  expect(back.origin + back.pathname).toBe(REDIRECT); expect(back.searchParams.get("state")).toBe("st1");
  return back.searchParams.get("code")!;
}
const token = (env: any, body: Record<string, string>) => app.request("/oauth/token", { method: "POST", body: new URLSearchParams(body), headers: { "content-type": "application/x-www-form-urlencoded" } }, env);
afterEach(() => vi.unstubAllGlobals());

describe("OAuth metadata", () => {
  it("publishes authorization server metadata with PKCE S256 and registration", async () => {
    const { env } = world();
    const m: any = await (await app.request("/.well-known/oauth-authorization-server", {}, env)).json();
    expect(m).toMatchObject({ issuer: "https://api.shipvo.dev", authorization_endpoint: "https://api.shipvo.dev/oauth/authorize", token_endpoint: "https://api.shipvo.dev/oauth/token", registration_endpoint: "https://api.shipvo.dev/oauth/register", code_challenge_methods_supported: ["S256"] });
  });
  it("sim publishes protected resource metadata and points 401s at it", async () => {
    const env: any = { CONTROL: "https://api.shipvo.dev", DB: world().env.DB };
    const m: any = await (await sim.fetch(new Request("https://sim.shipvo.dev/.well-known/oauth-protected-resource"), env)).json();
    expect(m).toMatchObject({ resource: "https://sim.shipvo.dev/mcp", authorization_servers: ["https://api.shipvo.dev"] });
    const r = await sim.fetch(new Request("https://sim.shipvo.dev/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call" }) }), env);
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain('resource_metadata="https://sim.shipvo.dev/.well-known/oauth-protected-resource"');
  });
});

describe("registration", () => {
  it("registers a public client and rejects bad redirect URIs", async () => {
    const { env } = world();
    const { r, body } = await register(env);
    expect(r.status).toBe(201); expect(body.client_id).toMatch(/^svc_/); expect(body.token_endpoint_auth_method).toBe("none");
    const bad = await app.request("/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) }, env);
    expect(bad.status).toBe(400);
  });
  it("never redirects to an unregistered redirect_uri", async () => {
    const { env } = world(); const { body } = await register(env);
    const r = await app.request(`/oauth/authorize?${new URLSearchParams({ client_id: body.client_id, redirect_uri: "https://evil.example/cb", response_type: "code", code_challenge: challenge, code_challenge_method: "S256" })}`, {}, env);
    expect(r.status).toBe(400);
  });
  it("requires PKCE S256", async () => {
    const { env } = world(); const { body } = await register(env);
    const r = await app.request(`/oauth/authorize?${new URLSearchParams({ client_id: body.client_id, redirect_uri: REDIRECT, response_type: "code" })}`, {}, env);
    expect(new URL(r.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
  });
});

describe("code exchange", () => {
  it("full PKCE flow issues a key, once", async () => {
    const w = world(); stubGithub();
    const { body } = await register(w.env);
    const code = await signIn(w.env, body.client_id);
    const bad = await token(w.env, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: body.client_id, code_verifier: "w".repeat(50) });
    expect(bad.status).toBe(400);   // wrong verifier burns the code
    expect(((await bad.json()) as any).error).toBe("invalid_grant");
    const code2 = await signIn(w.env, body.client_id);
    const ok = await token(w.env, { grant_type: "authorization_code", code: code2, redirect_uri: REDIRECT, client_id: body.client_id, code_verifier: verifier });
    expect(ok.status).toBe(200);
    const t: any = await ok.json();
    expect(t.token_type).toBe("Bearer"); expect(t.access_token).toMatch(/^sv_test_/); expect(t.expires_in).toBeGreaterThan(86400);
    expect(w.keys).toHaveLength(1);
    expect(w.keys[0].key_hash).not.toContain(t.access_token); expect(w.keys[0].account_id).toBe(1);
    const again = await token(w.env, { grant_type: "authorization_code", code: code2, redirect_uri: REDIRECT, client_id: body.client_id, code_verifier: verifier });
    expect(again.status).toBe(400);
  });
  it("refuses a code replayed by another client or an unknown state", async () => {
    const w = world(); stubGithub();
    const { body } = await register(w.env);
    const code = await signIn(w.env, body.client_id);
    expect((await token(w.env, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: "svc_other", code_verifier: verifier })).status).toBe(400);
    expect((await app.request("/oauth/callback?code=ghcode&state=nope", {}, w.env)).status).toBe(400);
  });
});

describe("a token from OAuth at sim.shipvo.dev", () => {
  async function issued() {
    const w = world(); stubGithub();
    const { body } = await register(w.env);
    const code = await signIn(w.env, body.client_id);
    const t: any = await (await token(w.env, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: body.client_id, code_verifier: verifier })).json();
    return { w, key: t.access_token as string };
  }
  // The sim Worker's own D1 lookups, answered from the same fake table.
  const simEnv = (w: ReturnType<typeof world>, backend: any) => ({ CONTROL: "https://api.shipvo.dev", E2B_API_KEY: "e", DB: { prepare: (sql: string) => ({ all: async () => ({ results: [] }), bind: (...a: any[]) => ({
    first: async () => /FROM api_keys WHERE key_hash/.test(sql) ? (w.keys.find((k) => k.key_hash === a[0] && !k.revoked_at) ?? null) : /sim_sessions/.test(sql) ? { sandbox_id: "sb", sandbox_host: "https://sb.test", rev: null } : null,
    all: async () => ({ results: [] }), run: async () => ({}) }) }) } }) as any;
  const call = (env: any, key: string) => sim.fetch(new Request("https://sim.shipvo.dev/mcp", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "screen" } }) }), env);

  it("opens a session: the request reaches the phone", async () => {
    const { w, key } = await issued();
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (u === "https://sb.test/health" ? new Response("ok") : Response.json({ jsonrpc: "2.0", id: 1, result: { ok: true } }))));
    const r = await call(simEnv(w, null), key);
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).result.ok).toBe(true);
  });
  it("refuses an expired token", async () => {
    const { w, key } = await issued();
    w.keys[0].expires_at = "2020-01-01T00:00:00.000Z";
    const r = await call(simEnv(w, null), key);
    expect(r.status).toBe(401); expect(((await r.json()) as any).error).toBe("expired_api_key");
    expect(r.headers.get("www-authenticate")).toContain("resource_metadata");
  });
  it("refuses a revoked token", async () => {
    const { w, key } = await issued();
    w.keys[0].revoked_at = "2026-01-01T00:00:00.000Z";
    const r = await call(simEnv(w, null), key);
    expect(r.status).toBe(401); expect(((await r.json()) as any).error).toBe("invalid_api_key");
  });
  it("keeps unauthenticated discovery working", async () => {
    const { w } = await issued();
    const rpc = (method: string) => sim.fetch(new Request("https://sim.shipvo.dev/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }) }), simEnv(w, null));
    expect(((await (await rpc("initialize")).json()) as any).result.serverInfo.name).toBe("shipvo");
    expect(((await (await rpc("tools/list")).json()) as any).result.tools.length).toBeGreaterThan(0);
  });
});
