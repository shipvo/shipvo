import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { canonicalize, parseXml } from "../src/saml.js";
import { createSamlRoutes } from "../src/saml-routes.js";
import { ssoSession } from "../src/sso.js";

const enc = new TextEncoder();
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const b64 = (u: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(u)));
const alg = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const idp = (await crypto.subtle.generateKey(alg, true, ["sign", "verify"])) as CryptoKeyPair;
const other = (await crypto.subtle.generateKey(alg, true, ["sign", "verify"])) as CryptoKeyPair;
const der = (tag: number, ...parts: Uint8Array[]) => {
  const body = parts.reduce((a, p) => { const o = new Uint8Array(a.length + p.length); o.set(a); o.set(p, a.length); return o; }, new Uint8Array());
  const len = body.length < 128 ? [body.length] : body.length < 256 ? [0x81, body.length] : [0x82, body.length >> 8, body.length & 255];
  return Uint8Array.from([tag, ...len, ...body]);
};
async function certFor(k: CryptoKeyPair) {
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", k.publicKey));
  const f = der(0x30);
  return b64(der(0x30, der(0x30, der(0xa0, der(0x02, Uint8Array.of(2))), der(0x02, Uint8Array.of(1)), f, f, f, f, spki), f, der(0x03, Uint8Array.of(0))));
}
const ISS = "https://idp.example.com/meta";
const AUD = "https://cp.example.com/saml/acme";
const org = { issuer: ISS, audience: AUD, certificate: await certFor(idp), ssoUrl: "https://idp.example.com/sso", mapping: { groups: { eng: "developer", ops: "admin" } } };

interface Opts { id?: string; issuer?: string; audience?: string; na?: number; irt?: string; key?: CryptoKey; groups?: string[] }
async function response(o: Opts & { irt: string | null }) {
  const id = o.id ?? "_a1";
  const irt = o.irt === null ? "" : ` InResponseTo="${o.irt}"`;
  const a = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${iso(NOW)}"><saml:Issuer>${o.issuer ?? ISS}</saml:Issuer>` +
    `<saml:Subject><saml:NameID>alice@acme.com</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData${irt} NotOnOrAfter="${iso(o.na ?? NOW + 300_000)}"/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(NOW - 60_000)}" NotOnOrAfter="${iso(o.na ?? NOW + 300_000)}"><saml:AudienceRestriction><saml:Audience>${o.audience ?? AUD}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AttributeStatement><saml:Attribute Name="groups">${(o.groups ?? ["eng"]).map((g) => `<saml:AttributeValue>${g}</saml:AttributeValue>`).join("")}</saml:Attribute></saml:AttributeStatement></saml:Assertion>`;
  const digest = b64(await crypto.subtle.digest("SHA-256", enc.encode(canonicalize(parseXml(a)))));
  const si = `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/><ds:Reference URI="#${id}"><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${digest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;
  const sv = b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", o.key ?? idp.privateKey, enc.encode(canonicalize(parseXml(si)))));
  const sig = `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${si.replace(' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"', "")}<ds:SignatureValue>${sv}</ds:SignatureValue></ds:Signature>`;
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r1" Version="2.0"${o.irt === null ? "" : ` InResponseTo="${o.irt}"`}><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${a.replace("</saml:Issuer>", `</saml:Issuer>${sig}`)}</samlp:Response>`;
  return btoa(xml);
}

function setup() {
  const kv = new Map<string, string>();
  const POINTERS = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } };
  const app = new Hono<any>();
  app.route("/", createSamlRoutes());
  const env = { POINTERS, SAML_ORGS: JSON.stringify({ acme: org }) };
  const req = (path: string, init: RequestInit = {}) => app.request(`https://cp.example.com${path}`, init, env);
  const acs = (resp: string, cookie?: string, name = "acme") =>
    req(`/saml/${name}/acs`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) }, body: new URLSearchParams({ SAMLResponse: resp }).toString() });
  /** Runs /start and returns the request id and the cookie the browser keeps. */
  async function start() {
    const res = await req("/saml/acme/start");
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
    return { res, cookie, id: cookie.split("=")[1]! };
  }
  return { req, acs, start, kv, env };
}
const refused = async (res: Response) => { expect(res.status).toBeGreaterThanOrEqual(400); expect(res.headers.get("set-cookie") ?? "").not.toContain("sv_sso="); expect(await res.text()).not.toContain("sv_sso_"); };

describe("saml login", () => {
  it("metadata gives the entity id and ACS URL", async () => {
    const res = await setup().req("/saml/acme/metadata");
    const xml = await res.text();
    expect(res.status).toBe(200);
    expect(xml).toContain('entityID="https://cp.example.com/saml/acme"');
    expect(xml).toContain('Location="https://cp.example.com/saml/acme/acs"');
  });
  it("unknown org is 404 on every route", async () => {
    const t = setup();
    expect((await t.req("/saml/nope/start")).status).toBe(404);
    expect((await t.req("/saml/nope/metadata")).status).toBe(404);
    expect((await t.acs("x", "sv_saml_req=_x", "nope")).status).toBe(404);
  });
  it("start redirects to the IdP with a stored request id", async () => {
    const t = setup(); const s = await t.start();
    expect(s.res.status).toBe(302);
    const loc = new URL(s.res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(org.ssoUrl);
    expect(loc.searchParams.get("SAMLRequest")).toBeTruthy();
    expect(t.kv.has(`saml/req/${s.id}`)).toBe(true);
  });
  it("valid signed response gives a session with the mapped role", async () => {
    const t = setup(); const s = await t.start();
    const res = await t.acs(await response({ irt: s.id, groups: ["ops"] }), s.cookie);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toMatchObject({ ok: true, org: "acme", role: "admin" });
    const token = /sv_sso=([^;]+)/.exec(res.headers.get("set-cookie")!)![1]!;
    expect(await ssoSession(t.env as any, token)).toMatchObject({ org: "acme", role: "admin", sub: "alice@acme.com" });
  });
  it("refuses wrong issuer", async () => { const t = setup(); const s = await t.start(); await refused(await t.acs(await response({ irt: s.id, issuer: "https://evil.example" }), s.cookie)); });
  it("refuses wrong audience", async () => { const t = setup(); const s = await t.start(); await refused(await t.acs(await response({ irt: s.id, audience: "https://evil.example" }), s.cookie)); });
  it("refuses expired", async () => { const t = setup(); const s = await t.start(); await refused(await t.acs(await response({ irt: s.id, na: NOW - 300_000 }), s.cookie)); });
  it("refuses bad signature", async () => { const t = setup(); const s = await t.start(); await refused(await t.acs(await response({ irt: s.id, key: other.privateKey }), s.cookie)); });
  it("refuses a user with no role", async () => {
    const t = setup(); const s = await t.start();
    const res = await t.acs(await response({ irt: s.id, groups: ["x"] }), s.cookie);
    expect(res.status).toBe(403); await refused(res);
  });
  it("refuses a replayed assertion even with a fresh request id", async () => {
    const t = setup();
    const s1 = await t.start();
    expect((await t.acs(await response({ irt: s1.id }), s1.cookie)).status).toBe(200);
    // Same assertion id, new request: the old request id is gone and the assertion id is used.
    await refused(await t.acs(await response({ irt: s1.id }), s1.cookie));
    const s2 = await t.start();
    await refused(await t.acs(await response({ irt: s2.id }), s2.cookie)); // same assertion id "_a1" under the shared replay map
  });
  it("refuses unknown InResponseTo", async () => {
    const t = setup(); const s = await t.start();
    await refused(await t.acs(await response({ irt: "_other" }), s.cookie));
  });
  it("refuses a request id that was never issued", async () => {
    const t = setup();
    await refused(await t.acs(await response({ irt: "_forged" }), "sv_saml_req=_forged"));
  });
  it("refuses an unsolicited response", async () => {
    const t = setup();
    await refused(await t.acs(await response({ irt: null })));
    const s = await t.start();
    await refused(await t.acs(await response({ irt: null }), s.cookie));
  });
  it("refuses a request id started for another org", async () => {
    const t = setup();
    t.kv.set("saml/req/_x", JSON.stringify({ org: "other" }));
    await refused(await t.acs(await response({ irt: "_x" }), "sv_saml_req=_x"));
  });
});
