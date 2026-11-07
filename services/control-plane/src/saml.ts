// SAML 2.0 response verification (HTTP-POST binding). A pure verifier: not wired to a route yet.
// No XML library: the parser below is deliberately small and strict, and it refuses DTDs outright.
import { mapClaimsToRole, type Claims, type RoleMapping } from "./oidc.js";
import type { Role } from "./roles.js";

export interface SamlConfig {
  /** Expected Issuer (the IdP entity id). */
  issuer: string;
  /** Our entity id; must appear as an Audience. */
  audience: string;
  /** IdP signing certificate: PEM, or base64 of the DER. Only this key is trusted; KeyInfo in the response is ignored. */
  certificate: string;
  mapping: RoleMapping;
  /** Id of the AuthnRequest we sent. When set, the response must answer it. When unset, a response that claims to answer a request is refused. */
  inResponseTo?: string;
  /** Allowed clock skew in seconds. Default 60. */
  clockSkewSec?: number;
  /** Assertion ids already used, with their expiry in ms. Pass the same Map on every call. */
  replay: Map<string, number>;
}

export interface SamlResult {
  subject: string;
  role: Role;
  attributes: Record<string, string[]>;
  assertionId: string;
}

export class SamlError extends Error {
  constructor(public reason: string) {
    super(`saml: ${reason}`);
  }
}

const NS_SAMLP = "urn:oasis:names:tc:SAML:2.0:protocol";
const NS_SAML = "urn:oasis:names:tc:SAML:2.0:assertion";
const NS_DS = "http://www.w3.org/2000/09/xmldsig#";
const ALG_C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
const ALG_ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const ALG_RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const ALG_SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const STATUS_OK = "urn:oasis:names:tc:SAML:2.0:status:Success";

// ---- minimal XML tree ----
interface Attr { prefix: string; local: string; ns: string; value: string }
interface El {
  prefix: string; local: string; ns: string;
  attrs: Attr[]; decls: Map<string, string>; kids: (El | string)[]; parent: El | null;
}

const lookupNs = (e: El | null, prefix: string): string | undefined => {
  for (; e; e = e.parent) if (e.decls.has(prefix)) return e.decls.get(prefix);
  return prefix === "xml" ? "http://www.w3.org/XML/1998/namespace" : undefined;
};

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_m, g: string) => {
    if (g[0] === "#") {
      const cp = g[1] === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      if (!(cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0x10ffff && cp !== 0xfffe && cp !== 0xffff && !(cp >= 0xd800 && cp <= 0xdfff)))) throw new SamlError("bad character reference");
      return String.fromCodePoint(cp);
    }
    return ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" } as Record<string, string>)[g]!;
  });
}
const noStrayAmp = (s: string) => { if (/&(?!(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);)/.test(s)) throw new SamlError("unknown entity"); };

export function parseXml(xml: string): El {
  if (typeof xml !== "string" || !xml) throw new SamlError("empty response");
  if (/<!DOCTYPE|<!ENTITY|<!ELEMENT|<!ATTLIST/i.test(xml)) throw new SamlError("doctype and entities are refused");
  let i = 0;
  let root: El | null = null;
  let cur: El | null = null;
  const text = (t: string) => {
    if (!t) return;
    if (!cur) { if (t.trim()) throw new SamlError("text outside root"); return; }
    noStrayAmp(t);
    cur.kids.push(unescapeXml(t));
  };
  while (i < xml.length) {
    if (xml[i] !== "<") {
      const j = xml.indexOf("<", i);
      const end = j < 0 ? xml.length : j;
      text(xml.slice(i, end));
      i = end;
    } else if (xml.startsWith("<!--", i)) {
      const j = xml.indexOf("-->", i + 4);
      if (j < 0) throw new SamlError("malformed xml");
      i = j + 3;
    } else if (xml.startsWith("<![CDATA[", i)) {
      const j = xml.indexOf("]]>", i);
      if (j < 0 || !cur) throw new SamlError("malformed xml");
      cur.kids.push(xml.slice(i + 9, j));
      i = j + 3;
    } else if (xml.startsWith("<?", i)) {
      const j = xml.indexOf("?>", i);
      if (j < 0 || i !== 0 || !/^<\?xml\s/.test(xml)) throw new SamlError("processing instructions are refused");
      i = j + 2;
    } else if (xml.startsWith("</", i)) {
      const j = xml.indexOf(">", i);
      const name = j < 0 ? "" : xml.slice(i + 2, j).trim();
      if (!cur || name !== (cur.prefix ? `${cur.prefix}:${cur.local}` : cur.local)) throw new SamlError("malformed xml");
      cur = cur.parent;
      i = j + 1;
    } else {
      const m = /^<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)((?:\s+[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/.exec(xml.slice(i));
      if (!m) throw new SamlError("malformed xml");
      i += m[0].length;
      const [p, l] = m[1]!.includes(":") ? m[1]!.split(":") as [string, string] : ["", m[1]!];
      const el: El = { prefix: p, local: l, ns: "", attrs: [], decls: new Map(), kids: [], parent: cur };
      const raw: { p: string; l: string; v: string }[] = [];
      for (const a of m[2]!.matchAll(/([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        const [ap, al] = a[1]!.includes(":") ? a[1]!.split(":") as [string, string] : ["", a[1]!];
        const v = a[2] ?? a[3] ?? "";
        noStrayAmp(v);
        raw.push({ p: ap, l: al, v: unescapeXml(v.replace(/[\t\n\r]/g, " ")) });
      }
      for (const a of raw) {
        if (a.p === "" && a.l === "xmlns") el.decls.set("", a.v);
        else if (a.p === "xmlns") el.decls.set(a.l, a.v);
      }
      el.ns = lookupNs(el, p) ?? "";
      if (p && !el.ns) throw new SamlError("unbound prefix");
      for (const a of raw) {
        if ((a.p === "" && a.l === "xmlns") || a.p === "xmlns") continue;
        const ns = a.p ? lookupNs(el, a.p) : "";
        if (a.p && !ns) throw new SamlError("unbound prefix");
        if (el.attrs.some((x) => x.local === a.l && x.ns === ns)) throw new SamlError("duplicate attribute");
        el.attrs.push({ prefix: a.p, local: a.l, ns: ns ?? "", value: a.v });
      }
      if (cur) cur.kids.push(el);
      else if (root) throw new SamlError("more than one root");
      else root = el;
      if (!m[3]) cur = el;
    }
  }
  if (!root || cur) throw new SamlError("malformed xml");
  return root;
}

// ---- exclusive canonicalization (no comments) ----
const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Exclusive C14N of one element. `skip` is left out (enveloped-signature transform). */
export function canonicalize(e: El, skip?: El, rendered: Map<string, string> = new Map()): string {
  const used = new Set<string>([e.prefix]);
  for (const a of e.attrs) if (a.prefix) used.add(a.prefix);
  const out = new Map(rendered);
  const decls: [string, string][] = [];
  for (const p of used) {
    const uri = lookupNs(e, p) ?? "";
    if ((out.get(p) ?? "") !== uri) { decls.push([p, uri]); out.set(p, uri); }
  }
  decls.sort((a, b) => cmp(a[0], b[0]));
  const attrs = [...e.attrs].sort((a, b) => cmp(a.ns, b.ns) || cmp(a.local, b.local));
  const name = e.prefix ? `${e.prefix}:${e.local}` : e.local;
  let s = `<${name}`;
  for (const [p, u] of decls) s += ` ${p ? `xmlns:${p}` : "xmlns"}="${escAttr(u)}"`;
  for (const a of attrs) s += ` ${a.prefix ? `${a.prefix}:${a.local}` : a.local}="${escAttr(a.value)}"`;
  s += ">";
  for (const k of e.kids) {
    if (typeof k === "string") s += escText(k);
    else if (k !== skip) s += canonicalize(k, skip, out);
  }
  return `${s}</${name}>`;
}

// ---- helpers ----
const children = (e: El, ns: string, local: string) => e.kids.filter((k): k is El => typeof k !== "string" && k.ns === ns && k.local === local);
const one = (e: El, ns: string, local: string, what: string): El => {
  const c = children(e, ns, local);
  if (c.length !== 1) throw new SamlError(`expected one ${what}`);
  return c[0]!;
};
const textOf = (e: El) => e.kids.filter((k) => typeof k === "string").join("").trim();
const attr = (e: El, name: string) => e.attrs.find((a) => a.local === name && a.ns === "")?.value;
const all = (e: El, out: El[] = []): El[] => { out.push(e); for (const k of e.kids) if (typeof k !== "string") all(k, out); return out; };

// ---- certificate: pull the public key out of an X.509 DER without a library ----
function derRead(b: Uint8Array, pos: number): { tag: number; start: number; end: number } {
  const tag = b[pos];
  let len = b[pos + 1];
  let start = pos + 2;
  if (tag === undefined || len === undefined) throw new SamlError("bad certificate");
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 3) throw new SamlError("bad certificate");
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + (b[start + k] ?? 0);
    start += n;
  }
  if (start + len > b.length) throw new SamlError("bad certificate");
  return { tag, start, end: start + len };
}

export function certificateToSpki(cert: string): Uint8Array {
  let der: Uint8Array;
  try {
    const bin = atob(cert.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""));
    der = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch { throw new SamlError("bad certificate"); }
  const c = derRead(der, 0);
  const tbs = derRead(der, c.start);
  let pos = tbs.start;
  if (der[pos] === 0xa0) pos = derRead(der, pos).end; // version
  for (let k = 0; k < 5; k++) pos = derRead(der, pos).end; // serial, sig alg, issuer, validity, subject
  const spki = derRead(der, pos);
  if (spki.tag !== 0x30) throw new SamlError("bad certificate");
  return der.slice(pos, spki.end);
}

const b64Bytes = (s: string) => {
  try { return Uint8Array.from(atob(s.replace(/\s+/g, "")), (c) => c.charCodeAt(0)); } catch { throw new SamlError("bad base64"); }
};
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, k) => v === b[k]);

async function verifySignature(sig: El, signed: El, config: SamlConfig): Promise<void> {
  const info = one(sig, NS_DS, "SignedInfo", "SignedInfo");
  if (attr(one(info, NS_DS, "CanonicalizationMethod", "CanonicalizationMethod"), "Algorithm") !== ALG_C14N) throw new SamlError("canonicalization not allowed");
  if (attr(one(info, NS_DS, "SignatureMethod", "SignatureMethod"), "Algorithm") !== ALG_RSA_SHA256) throw new SamlError("signature algorithm not allowed");
  const ref = one(info, NS_DS, "Reference", "Reference");
  const id = attr(signed, "ID");
  if (!id || attr(ref, "URI") !== `#${id}`) throw new SamlError("signature does not cover the assertion");
  const transforms = children(one(ref, NS_DS, "Transforms", "Transforms"), NS_DS, "Transform");
  if (!transforms.length || transforms.length > 2) throw new SamlError("transform not allowed");
  for (const t of transforms) {
    const alg = attr(t, "Algorithm");
    if ((alg !== ALG_ENVELOPED && alg !== ALG_C14N) || t.kids.some((k) => typeof k !== "string")) throw new SamlError("transform not allowed");
  }
  if (attr(one(ref, NS_DS, "DigestMethod", "DigestMethod"), "Algorithm") !== ALG_SHA256) throw new SamlError("digest algorithm not allowed");
  const enc = new TextEncoder();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(canonicalize(signed, sig))));
  if (!sameBytes(digest, b64Bytes(textOf(one(ref, NS_DS, "DigestValue", "DigestValue"))))) throw new SamlError("digest mismatch");
  let ok = false;
  try {
    const key = await crypto.subtle.importKey("spki", certificateToSpki(config.certificate), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64Bytes(textOf(one(sig, NS_DS, "SignatureValue", "SignatureValue"))), enc.encode(canonicalize(info)));
  } catch (e) { if (e instanceof SamlError && e.reason !== "bad base64") throw e; ok = false; }
  if (!ok) throw new SamlError("bad signature");
}

function time(v: string | undefined, what: string): number | undefined {
  if (v === undefined) return undefined;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(v)) throw new SamlError(`bad ${what}`);
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new SamlError(`bad ${what}`);
  return t;
}

/** Verifies a decoded SAML response. `now` is in ms. Returns the subject and role, or throws SamlError. */
export async function verifySamlResponse(xml: string, config: SamlConfig, now: number): Promise<SamlResult> {
  const doc = parseXml(xml);
  if (doc.ns !== NS_SAMLP || doc.local !== "Response") throw new SamlError("not a SAML response");
  const elements = all(doc);

  // Structure first: one assertion, in its normal place, unique ids, signatures only where we expect them.
  const assertions = elements.filter((e) => e.ns === NS_SAML && (e.local === "Assertion" || e.local === "EncryptedAssertion"));
  if (assertions.length !== 1 || assertions[0]!.local !== "Assertion" || assertions[0]!.parent !== doc) throw new SamlError("signature wrapping: expected exactly one assertion");
  const assertion = assertions[0]!;
  const ids = elements.map((e) => attr(e, "ID")).filter((v): v is string => v !== undefined);
  if (new Set(ids).size !== ids.length) throw new SamlError("signature wrapping: duplicate ID");
  const sigs = elements.filter((e) => e.ns === NS_DS && e.local === "Signature");
  const aSig = children(assertion, NS_DS, "Signature");
  const rSig = children(doc, NS_DS, "Signature");
  if (sigs.some((s) => s.parent !== assertion && s.parent !== doc) || aSig.length > 1 || rSig.length > 1) throw new SamlError("signature wrapping: unexpected signature");
  const signature = aSig[0] ?? rSig[0];
  if (!signature) throw new SamlError("unsigned assertion");
  await verifySignature(signature, signature.parent!, config);

  // Everything below reads only the assertion that the verified signature covers.
  if (attr(one(one(doc, NS_SAMLP, "Status", "Status"), NS_SAMLP, "StatusCode", "StatusCode"), "Value") !== STATUS_OK) throw new SamlError("response status is not success");
  if (textOf(one(assertion, NS_SAML, "Issuer", "Issuer")) !== config.issuer) throw new SamlError("wrong issuer");
  const skew = (config.clockSkewSec ?? 60) * 1000;

  const cond = one(assertion, NS_SAML, "Conditions", "Conditions");
  const nb = time(attr(cond, "NotBefore"), "NotBefore");
  const na = time(attr(cond, "NotOnOrAfter"), "NotOnOrAfter");
  if (na === undefined) throw new SamlError("NotOnOrAfter is required");
  if (nb !== undefined && now + skew < nb) throw new SamlError("assertion is not valid yet");
  if (now - skew >= na) throw new SamlError("assertion has expired");
  const audiences = children(cond, NS_SAML, "AudienceRestriction");
  if (!audiences.length || !audiences.every((r) => children(r, NS_SAML, "Audience").some((a) => textOf(a) === config.audience))) throw new SamlError("wrong audience");

  const subject = one(assertion, NS_SAML, "Subject", "Subject");
  const confirmations = children(subject, NS_SAML, "SubjectConfirmation")
    .filter((c) => attr(c, "Method") === "urn:oasis:names:tc:SAML:2.0:cm:bearer")
    .flatMap((c) => children(c, NS_SAML, "SubjectConfirmationData"));
  if (confirmations.length !== 1) throw new SamlError("expected one bearer confirmation");
  const conf = confirmations[0]!;
  const confEnd = time(attr(conf, "NotOnOrAfter"), "NotOnOrAfter");
  if (confEnd !== undefined && now - skew >= confEnd) throw new SamlError("assertion has expired");
  for (const irt of [attr(doc, "InResponseTo"), attr(conf, "InResponseTo")]) {
    if (config.inResponseTo === undefined ? irt !== undefined : irt !== config.inResponseTo) throw new SamlError("wrong InResponseTo");
  }
  if (config.inResponseTo !== undefined && attr(conf, "InResponseTo") === undefined) throw new SamlError("wrong InResponseTo");

  const nameId = textOf(one(subject, NS_SAML, "NameID", "NameID"));
  if (!nameId) throw new SamlError("empty subject");
  const attributes: Record<string, string[]> = Object.create(null);
  for (const st of children(assertion, NS_SAML, "AttributeStatement")) {
    for (const a of children(st, NS_SAML, "Attribute")) {
      const name = attr(a, "Name");
      if (name) (attributes[name] ??= []).push(...children(a, NS_SAML, "AttributeValue").map(textOf));
    }
  }
  // Same mapping as OIDC. The IdP vouches for the address in a signed assertion, so it counts as verified.
  const claims: Claims = { ...attributes };
  const email = attributes.email?.[0] ?? (nameId.includes("@") ? nameId : undefined);
  if (email) { claims.email = email; claims.email_verified = true; }
  const role = mapClaimsToRole(claims, config.mapping);
  if (!role) throw new SamlError("no role for this user");

  // Replay check last, so a response that fails any other check does not use up its id.
  const assertionId = attr(assertion, "ID")!;
  for (const [k, exp] of config.replay) if (exp <= now) config.replay.delete(k);
  if (config.replay.has(assertionId)) throw new SamlError("assertion id was already used");
  config.replay.set(assertionId, Math.max(na, confEnd ?? 0) + skew);
  return { subject: nameId, role, attributes: { ...attributes }, assertionId };
}
