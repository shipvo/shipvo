import { describe, expect, it } from "vitest";
import { canonicalize, parseXml, SamlError, verifySamlResponse, type SamlConfig } from "../src/saml.js";

const enc = new TextEncoder();
const NOW = Date.parse("2026-11-07T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const b64 = (u: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(u)));
const alg = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const idp = (await crypto.subtle.generateKey(alg, true, ["sign", "verify"])) as CryptoKeyPair;
const other = (await crypto.subtle.generateKey(alg, true, ["sign", "verify"])) as CryptoKeyPair;

// A minimal certificate: only the structure the verifier walks (version, serial, alg, issuer, validity, subject, key).
const der = (tag: number, ...parts: Uint8Array[]) => {
  const body = parts.reduce((a, p) => { const o = new Uint8Array(a.length + p.length); o.set(a); o.set(p, a.length); return o; }, new Uint8Array());
  const len = body.length < 128 ? [body.length] : body.length < 256 ? [0x81, body.length] : [0x82, body.length >> 8, body.length & 255];
  return Uint8Array.from([tag, ...len, ...body]);
};
async function certFor(k: CryptoKeyPair) {
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", k.publicKey));
  const filler = der(0x30);
  const tbs = der(0x30, der(0xa0, der(0x02, Uint8Array.of(2))), der(0x02, Uint8Array.of(1)), filler, filler, filler, filler, spki);
  return `-----BEGIN CERTIFICATE-----\n${b64(der(0x30, tbs, filler, der(0x03, Uint8Array.of(0))))}\n-----END CERTIFICATE-----`;
}
const cert = await certFor(idp);

const config = (over: Partial<SamlConfig> = {}): SamlConfig => ({
  issuer: "https://idp.example.com/meta", audience: "https://shipvo.example/sp", certificate: cert,
  mapping: { groups: { eng: "developer", ops: "admin" } }, inResponseTo: "req1", replay: new Map(), ...over,
});

interface Opts { id?: string; issuer?: string; audience?: string; nb?: number; na?: number; irt?: string | null; groups?: string[]; email?: string }
const assertionXml = (o: Opts = {}) => {
  const id = o.id ?? "_a1";
  const irt = o.irt === null ? "" : ` InResponseTo="${o.irt ?? "req1"}"`;
  return `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${iso(NOW)}">` +
    `<saml:Issuer>${o.issuer ?? "https://idp.example.com/meta"}</saml:Issuer>` +
    `<saml:Subject><saml:NameID>alice@acme.com</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData${irt} NotOnOrAfter="${iso(o.na ?? NOW + 300_000)}"/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(o.nb ?? NOW - 60_000)}" NotOnOrAfter="${iso(o.na ?? NOW + 300_000)}"><saml:AudienceRestriction><saml:Audience>${o.audience ?? "https://shipvo.example/sp"}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AttributeStatement><saml:Attribute Name="groups">${(o.groups ?? ["eng"]).map((g) => `<saml:AttributeValue>${g}</saml:AttributeValue>`).join("")}</saml:Attribute>` +
    `<saml:Attribute Name="email"><saml:AttributeValue>${o.email ?? "alice@acme.com"}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`;
};
const wrap = (inner: string, irt: string | null = "req1") =>
  `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r1" Version="2.0"${irt === null ? "" : ` InResponseTo="${irt}"`}>` +
  `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${inner}</samlp:Response>`;

/** Signs the assertion (enveloped), optionally pointing the reference at another id or signing with another key. */
async function signAssertion(xml: string, o: { refId?: string; key?: CryptoKey; digestOf?: string } = {}) {
  const root = parseXml(xml);
  const id = root.attrs.find((a) => a.local === "ID")!.value;
  const digest = b64(await crypto.subtle.digest("SHA-256", enc.encode(canonicalize(parseXml(o.digestOf ?? xml)))));
  const signedInfo = `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
    `<ds:Reference URI="#${o.refId ?? id}"><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${digest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;
  const sv = b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", o.key ?? idp.privateKey, enc.encode(canonicalize(parseXml(signedInfo)))));
  const sig = `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${signedInfo.replace(' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"', "")}<ds:SignatureValue>${sv}</ds:SignatureValue></ds:Signature>`;
  // The signature goes right after the Issuer, as SAML requires.
  return xml.replace("</saml:Issuer>", `</saml:Issuer>${sig}`);
}
const signed = async (o: Opts = {}) => wrap(await signAssertion(assertionXml(o)), o.irt);
const reason = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof SamlError) return e.reason; throw e; } return "accepted"; };

describe("verifySamlResponse", () => {
  it("returns subject, role and attributes for a valid signed response", async () => {
    const r = await verifySamlResponse(await signed(), config(), NOW);
    expect(r).toMatchObject({ subject: "alice@acme.com", role: "developer", assertionId: "_a1" });
    expect(r.attributes.groups).toEqual(["eng"]);
  });
  it("takes the highest role across groups", async () => {
    expect((await verifySamlResponse(await signed({ groups: ["eng", "ops"] }), config(), NOW)).role).toBe("admin");
  });
  it("refuses a user with no role", async () => {
    expect(await reason(verifySamlResponse(await signed({ groups: ["x"], email: "a@other.org" }), config(), NOW))).toMatch(/no role/);
  });
  it("accepts a signature on the Response when the Response has the signature", async () => {
    // Sign the Response element itself.
    const body = wrap(assertionXml());
    const root = parseXml(body);
    const digest = b64(await crypto.subtle.digest("SHA-256", enc.encode(canonicalize(root))));
    const si = `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/><ds:Reference URI="#_r1"><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${digest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;
    const sv = b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", idp.privateKey, enc.encode(canonicalize(parseXml(si)))));
    const xml = body.replace("<samlp:Status>", `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${si.replace(' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"', "")}<ds:SignatureValue>${sv}</ds:SignatureValue></ds:Signature><samlp:Status>`);
    expect((await verifySamlResponse(xml, config(), NOW)).role).toBe("developer");
  });

  it("refuses the wrong audience", async () => {
    expect(await reason(verifySamlResponse(await signed({ audience: "https://evil.example" }), config(), NOW))).toBe("wrong audience");
  });
  it("refuses an expired assertion", async () => {
    expect(await reason(verifySamlResponse(await signed({ na: NOW - 120_000 }), config(), NOW))).toBe("assertion has expired");
  });
  it("allows a small clock skew past the end", async () => {
    expect((await verifySamlResponse(await signed({ na: NOW - 30_000 }), config(), NOW)).role).toBe("developer");
  });
  it("refuses an assertion that is not valid yet", async () => {
    expect(await reason(verifySamlResponse(await signed({ nb: NOW + 600_000, na: NOW + 900_000 }), config(), NOW))).toBe("assertion is not valid yet");
  });
  it("refuses the wrong issuer", async () => {
    expect(await reason(verifySamlResponse(await signed({ issuer: "https://evil.example" }), config(), NOW))).toBe("wrong issuer");
  });
  it("refuses a bad signature (signed with another key)", async () => {
    const xml = wrap(await signAssertion(assertionXml(), { key: other.privateKey }));
    expect(await reason(verifySamlResponse(xml, config(), NOW))).toBe("bad signature");
  });
  it("refuses an assertion edited after signing", async () => {
    const xml = (await signed()).replace("alice@acme.com</saml:NameID>", "root@acme.com</saml:NameID>");
    expect(await reason(verifySamlResponse(xml, config(), NOW))).toBe("digest mismatch");
  });
  it("refuses an unsigned assertion", async () => {
    expect(await reason(verifySamlResponse(wrap(assertionXml()), config(), NOW))).toBe("unsigned assertion");
  });
  it("refuses signature wrapping: a forged assertion beside the signed one", async () => {
    const good = await signAssertion(assertionXml());
    const forged = assertionXml({ id: "_evil", groups: ["ops"] });
    const xml = wrap(`${forged}<samlp:Extensions xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">${good}</samlp:Extensions>`);
    expect(await reason(verifySamlResponse(xml, config(), NOW))).toMatch(/signature wrapping/);
  });
  it("refuses a signature over a different element than the assertion", async () => {
    const xml = wrap(await signAssertion(assertionXml(), { refId: "_r1" }));
    expect(await reason(verifySamlResponse(xml, config(), NOW))).toBe("signature does not cover the assertion");
  });
  it("refuses a signature whose digest covers other content", async () => {
    const xml = wrap(await signAssertion(assertionXml({ groups: ["ops"] }), { digestOf: assertionXml() }));
    expect(await reason(verifySamlResponse(xml, config(), NOW))).toBe("digest mismatch");
  });
  it("refuses a doctype with external entities", async () => {
    const xml = (await signed()).replace("<samlp:Response", `<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><samlp:Response`);
    expect(await reason(verifySamlResponse(xml, config(), NOW))).toBe("doctype and entities are refused");
  });
  it("refuses a replayed assertion id", async () => {
    const c = config();
    const xml = await signed();
    await verifySamlResponse(xml, c, NOW);
    expect(await reason(verifySamlResponse(xml, c, NOW + 1000))).toBe("assertion id was already used");
  });
  it("does not use up an id on a response that fails another check", async () => {
    const c = config();
    await reason(verifySamlResponse(await signed({ audience: "x" }), c, NOW));
    expect((await verifySamlResponse(await signed(), c, NOW)).role).toBe("developer");
  });
  it("refuses a response to a different request", async () => {
    expect(await reason(verifySamlResponse(await signed({ irt: "other" }), config(), NOW))).toBe("wrong InResponseTo");
  });
  it("refuses an unsolicited response when a request id is expected", async () => {
    expect(await reason(verifySamlResponse(await signed({ irt: null }), config(), NOW))).toBe("wrong InResponseTo");
  });
});

describe("canonicalize", () => {
  it("matches a known exclusive c14n output", () => {
    const x = `<a:r xmlns:b="urn:b" xmlns:a="urn:a" z="1" y='&amp;"'><!-- c --><a:c xmlns:a="urn:a"><![CDATA[<x>]]></a:c></a:r>`;
    expect(canonicalize(parseXml(x))).toBe(`<a:r xmlns:a="urn:a" y="&amp;&quot;" z="1"><a:c>&lt;x&gt;</a:c></a:r>`);
  });
});
