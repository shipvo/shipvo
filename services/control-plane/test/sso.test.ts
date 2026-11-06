import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createSsoRoutes } from "../src/sso.js";

const enc = new TextEncoder();
const b64 = (b: ArrayBuffer | string) => {
  const u = typeof b === "string" ? enc.encode(b) : new Uint8Array(b);
  let s = ""; for (const c of u) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const ISS = "https://idp.example.com", SECRET = "s3cret-value-xyz";
const org = {
  issuer: ISS, clientId: "shipvo", jwksUri: `${ISS}/jwks`, authorizationEndpoint: `${ISS}/authorize`, tokenEndpoint: `${ISS}/token`, secretRef: "ACME_SECRET",
  mapping: { groups: { "shipvo-admins": "admin" }, emailDomains: { "acme.com": "viewer" } },
};
const rsa = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
const jwk = { ...(await crypto.subtle.exportKey("jwk", rsa.publicKey)), kid: "k1", use: "sig" };

async function idToken(claims: object) {
  const h = b64(JSON.stringify({ alg: "RS256", kid: "k1" })), p = b64(JSON.stringify(claims));
  return `${h}.${p}.${b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", rsa.privateKey, enc.encode(`${h}.${p}`)))}`;
}

/** A fake provider: records the authorize request, issues single-use codes, checks the secret and PKCE. */
function setup(extra: object = {}, aud = "shipvo") {
  const kv = new Map<string, string>();
  const POINTERS = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } };
  const codes = new Map<string, { nonce: string; challenge: string }>();
  const logs: string[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    if (url === org.jwksUri) return new Response(JSON.stringify({ keys: [jwk] }));
    const f = new URLSearchParams(String(init?.body));
    const c = codes.get(f.get("code") ?? "");
    const verifier = f.get("code_verifier") ?? "";
    const chal = b64(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
    if (!c || f.get("client_secret") !== SECRET || c.challenge !== chal) return new Response("{}", { status: 400 });
    codes.delete(f.get("code")!);
    const now = Math.floor(Date.now() / 1000);
    return new Response(JSON.stringify({ id_token: await idToken({ iss: ISS, aud, sub: "u1", exp: now + 600, iat: now, nonce: c.nonce, email: "ann@acme.com", email_verified: true, groups: ["shipvo-admins"], ...extra }) }));
  };
  const app = new Hono<any>();
  app.route("/", createSsoRoutes({ fetch }));
  const env = { POINTERS, SSO_ORGS: JSON.stringify({ acme: org }), ACME_SECRET: SECRET };
  const req = (path: string, cookie?: string) => app.request(`https://cp.example.com${path}`, { headers: cookie ? { cookie } : {} }, env);
  /** Runs /start and plays the browser: returns the callback path and cookie. */
  async function start(name = "acme") {
    const res = await req(`/sso/${name}/start`);
    const loc = new URL(res.headers.get("location")!);
    const state = loc.searchParams.get("state")!;
    const code = "code-" + Math.random().toString(36).slice(2);
    codes.set(code, { nonce: loc.searchParams.get("nonce")!, challenge: loc.searchParams.get("code_challenge")! });
    return { res, loc, state, code, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0]! };
  }
  const orig = console.log; console.log = (...a) => { logs.push(a.join(" ")); };
  return { req, start, kv, logs, restore: () => { console.log = orig; } };
}

describe("sso login", () => {
  it("start redirects with state and PKCE", async () => {
    const t = setup(); const s = await t.start(); t.restore();
    expect(s.res.status).toBe(302);
    expect(s.loc.origin + s.loc.pathname).toBe(org.authorizationEndpoint);
    expect(s.loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(s.loc.searchParams.get("redirect_uri")).toBe("https://cp.example.com/sso/acme/callback");
    expect(s.loc.search).not.toContain(SECRET);
  });

  it("completes a login and creates a session with the mapped role", async () => {
    const t = setup(); const s = await t.start();
    const res = await t.req(`/sso/acme/callback?state=${s.state}&code=${s.code}`, s.cookie);
    t.restore();
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toMatchObject({ ok: true, org: "acme", role: "admin", email: "ann@acme.com" });
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/sv_sso=sv_sso_/);
    expect([...t.kv.keys()].some((k) => k.startsWith("sso/session/"))).toBe(true);
    expect(JSON.stringify(body) + cookie + t.logs.join("\n")).not.toContain(SECRET);
  });

  it("maps by verified email domain when no group matches", async () => {
    const t = setup({ groups: [] }); const s = await t.start();
    const res = await t.req(`/sso/acme/callback?state=${s.state}&code=${s.code}`, s.cookie); t.restore();
    expect((await res.json() as any).role).toBe("viewer");
  });

  it("refuses a state that does not match", async () => {
    const t = setup(); const s = await t.start();
    const res = await t.req(`/sso/acme/callback?state=other&code=${s.code}`, s.cookie); t.restore();
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe("bad_state");
  });

  it("refuses a callback without the browser's state cookie", async () => {
    const t = setup(); const s = await t.start();
    const res = await t.req(`/sso/acme/callback?state=${s.state}&code=${s.code}`); t.restore();
    expect((await res.json() as any).error).toBe("bad_state");
  });

  it("refuses a replayed callback", async () => {
    const t = setup(); const s = await t.start();
    const url = `/sso/acme/callback?state=${s.state}&code=${s.code}`;
    expect((await t.req(url, s.cookie)).status).toBe(200);
    const again = await t.req(url, s.cookie); t.restore();
    expect(again.status).toBe(400);
    expect((await again.json() as any).message).toMatch(/already used/);
  });

  it("refuses a replayed code under a fresh state", async () => {
    const t = setup(); const s = await t.start();
    expect((await t.req(`/sso/acme/callback?state=${s.state}&code=${s.code}`, s.cookie)).status).toBe(200);
    const s2 = await t.start();
    const res = await t.req(`/sso/acme/callback?state=${s2.state}&code=${s.code}`, s2.cookie); t.restore();
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe("code_refused");
  });

  it("refuses a token for the wrong audience", async () => {
    const t = setup({}, "someone-else"); const s = await t.start();
    const res = await t.req(`/sso/acme/callback?state=${s.state}&code=${s.code}`, s.cookie); t.restore();
    expect(res.status).toBe(400);
    expect((await res.json() as any).message).toMatch(/wrong audience/);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/sv_sso=sv_sso_/);
  });

  it("refuses unknown orgs", async () => {
    const t = setup();
    for (const p of ["/sso/nope/start", "/sso/nope/callback?state=a&code=b", "/sso/__proto__/start"]) {
      const res = await t.req(p);
      expect(res.status).toBe(404);
      expect((await res.json() as any).error).toBe("unknown_org");
    }
    t.restore();
  });

  it("gives no session to a person with no mapped role", async () => {
    const t = setup({ groups: [], email: "bob@other.com" }); const s = await t.start();
    const res = await t.req(`/sso/acme/callback?state=${s.state}&code=${s.code}`, s.cookie); t.restore();
    expect(res.status).toBe(403);
  });
});
