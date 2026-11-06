import { describe, expect, it } from "vitest";
import { mapClaimsToRole, validateOidcConfig, verifyIdToken, type OidcConfig, type OidcDeps } from "../src/oidc.js";

const enc = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array | string) => {
  const u = typeof b === "string" ? enc.encode(b) : new Uint8Array(b);
  let s = ""; for (const c of u) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const NOW = 1_800_000_000_000;
const config: OidcConfig = {
  issuer: "https://idp.example.com", clientId: "shipvo", jwksUri: "https://idp.example.com/jwks",
  mapping: { groups: { "shipvo-admins": "admin", eng: "developer" }, emailDomains: { "acme.com": "viewer" } },
};
const rsa = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
const ec = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
const pub = async (k: CryptoKey, kid: string) => ({ ...(await crypto.subtle.exportKey("jwk", k)), kid, use: "sig" });
const base = { iss: config.issuer, aud: "shipvo", sub: "u1", exp: NOW / 1000 + 600, iat: NOW / 1000, nonce: "n1" };

async function sign(alg: string, kid: string | undefined, claims: object, key?: CryptoKey) {
  const h = b64(JSON.stringify({ alg, typ: "JWT", ...(kid ? { kid } : {}) }));
  const p = b64(JSON.stringify(claims));
  if (alg === "none") return `${h}.${p}.`;
  const data = enc.encode(`${h}.${p}`);
  const sig = alg === "RS256" ? await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key ?? rsa.privateKey, data)
    : alg === "ES256" ? await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key ?? ec.privateKey, data)
    : await crypto.subtle.sign("HMAC", key!, data);
  return `${h}.${p}.${b64(sig)}`;
}

async function setup() {
  let fetches = 0;
  const keys = [await pub(rsa.publicKey, "rsa1"), await pub(ec.publicKey, "ec1")];
  let t = NOW;
  const deps: OidcDeps = { fetch: async () => { fetches++; return { ok: true, json: async () => ({ keys }) }; }, now: () => t, cache: new Map() };
  return { deps, keys, count: () => fetches, advance: (ms: number) => { t += ms; } };
}
const v = (tok: string, deps: OidcDeps, nonce = "n1") => verifyIdToken(tok, config, deps, { nonce });

describe("verifyIdToken", () => {
  it("accepts valid RS256 and ES256 tokens", async () => {
    const { deps } = await setup();
    expect((await v(await sign("RS256", "rsa1", base), deps)).sub).toBe("u1");
    expect((await v(await sign("ES256", "ec1", base), deps)).sub).toBe("u1");
  });
  const cases: [string, object, string][] = [
    ["wrong issuer", { ...base, iss: "https://evil.example.com" }, "wrong issuer"],
    ["wrong audience", { ...base, aud: "other" }, "wrong audience"],
    ["expired", { ...base, exp: NOW / 1000 - 3600 }, "expired"],
    ["not yet valid", { ...base, nbf: NOW / 1000 + 3600 }, "not yet valid"],
    ["iat far in future", { ...base, iat: NOW / 1000 + 3600 }, "iat"],
    ["wrong nonce", { ...base, nonce: "x" }, "nonce"],
  ];
  for (const [name, claims, msg] of cases) {
    it(`rejects ${name}`, async () => {
      const { deps } = await setup();
      await expect(v(await sign("RS256", "rsa1", claims), deps)).rejects.toThrow(msg);
    });
  }
  it("rejects alg none", async () => {
    const { deps } = await setup();
    await expect(v(await sign("none", "rsa1", base), deps)).rejects.toThrow("algorithm not allowed");
  });
  it("rejects HS256 signed with the public key", async () => {
    const { deps, keys } = await setup();
    const hk = await crypto.subtle.importKey("raw", enc.encode(JSON.stringify(keys[0])), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    await expect(v(await sign("HS256", "rsa1", base, hk), deps)).rejects.toThrow("algorithm not allowed");
  });
  it("rejects an RS256 header on an EC key", async () => {
    const { deps } = await setup();
    await expect(v(await sign("RS256", "ec1", base), deps)).rejects.toThrow();
  });
  it("rejects a tampered payload", async () => {
    const { deps } = await setup();
    const [h, , s] = (await sign("RS256", "rsa1", base)).split(".");
    await expect(v(`${h}.${b64(JSON.stringify({ ...base, sub: "admin" }))}.${s}`, deps)).rejects.toThrow("bad signature");
  });
  it("rejects an unknown kid and refetches only once in the gap", async () => {
    const { deps, count, advance } = await setup();
    const tok = await sign("RS256", "nope", base);
    await expect(v(tok, deps)).rejects.toThrow("unknown kid");
    expect(count()).toBe(1); // first load; refetch suppressed by min gap
    advance(61_000);
    await expect(v(tok, deps)).rejects.toThrow("unknown kid");
    expect(count()).toBe(2); // one refetch for the unknown kid
    await expect(v(tok, deps)).rejects.toThrow("unknown kid");
    expect(count()).toBe(2); // not on every request
    await v(await sign("RS256", "rsa1", base), deps);
    expect(count()).toBe(2); // known kid uses the cache
  });
  it("picks up a rotated key after one refetch", async () => {
    const { deps, keys, advance } = await setup();
    await v(await sign("RS256", "rsa1", base), deps);
    advance(61_000);
    keys.push(await pub(ec.publicKey, "ec2"));
    expect((await v(await sign("ES256", "ec2", base), deps)).sub).toBe("u1");
  });
  it("rejects malformed tokens and bad config", async () => {
    const { deps } = await setup();
    await expect(v("a.b", deps)).rejects.toThrow("malformed");
    await expect(verifyIdToken("a.b.c", { ...config, issuer: "http://x" }, deps, { nonce: "n1" })).rejects.toThrow("invalid config");
  });
});

describe("validateOidcConfig", () => {
  it("accepts a good config and flags bad ones", () => {
    expect(validateOidcConfig(config)).toEqual([]);
    expect(validateOidcConfig({ ...config, issuer: "http://idp" })).toContain("issuer must be an https URL");
    expect(validateOidcConfig({ ...config, clientId: "" })).toContain("clientId is required");
    expect(validateOidcConfig({ ...config, mapping: {} })).toHaveLength(1);
    expect(validateOidcConfig({ ...config, mapping: { groups: { a: "root" as never } } })).toContain("unknown role: root");
  });
});

describe("mapClaimsToRole", () => {
  const m = config.mapping;
  it("maps groups, the highest role wins", () => {
    expect(mapClaimsToRole({ groups: ["eng", "shipvo-admins"] }, m)).toBe("admin");
    expect(mapClaimsToRole({ groups: ["eng"] }, m)).toBe("developer");
  });
  it("maps a verified email domain only", () => {
    expect(mapClaimsToRole({ email: "a@Acme.com", email_verified: true }, m)).toBe("viewer");
    expect(mapClaimsToRole({ email: "a@acme.com" }, m)).toBeNull();
    expect(mapClaimsToRole({ email: "a@evil-acme.com", email_verified: true }, m)).toBeNull();
  });
  it("gives no access without a match", () => {
    expect(mapClaimsToRole({ groups: ["other"] }, m)).toBeNull();
    expect(mapClaimsToRole({ groups: ["__proto__", "constructor"] }, m)).toBeNull();
    expect(mapClaimsToRole({}, m)).toBeNull();
  });
  it("supports a custom group claim", () => {
    expect(mapClaimsToRole({ roles: "eng" }, { ...m, groupClaim: "roles" })).toBe("developer");
  });
});
