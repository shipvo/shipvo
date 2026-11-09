// SAML login: /saml/<org>/start, /saml/<org>/acs and /saml/<org>/metadata (slice 5 of #296).
// Uses the verifier in saml.ts. On success it issues the same session as the OIDC login (see sso.ts).
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SamlError, verifySamlResponse, type SamlConfig } from "./saml.js";
import type { RoleMapping } from "./oidc.js";

export interface SamlOrg extends Omit<SamlConfig, "inResponseTo" | "replay" | "clockSkewSec"> {
  /** https URL of the identity provider's single sign-on endpoint (HTTP-Redirect binding). */
  ssoUrl: string;
  mapping: RoleMapping;
}

type SamlEnv = { POINTERS: KVNamespace; SAML_ORGS?: string };

const REQUEST_TTL = 600;
const SESSION_TTL = 8 * 3600;
const MAX_RESPONSE = 256 * 1024;
const ORG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const enc = new TextEncoder();
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const rand = (n: number) => b64(crypto.getRandomValues(new Uint8Array(n))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const safeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const fail = (c: any, status: 400 | 403 | 404, error: string, message: string) => c.json({ error, message }, status, { "cache-control": "no-store" });

/** Reads one org's settings from the SAML_ORGS configuration (JSON object keyed by org). Null when absent or invalid. */
export function loadSamlOrg(env: SamlEnv, org: string): SamlOrg | null {
  if (!ORG.test(org) || !env.SAML_ORGS) return null;
  try {
    const all = JSON.parse(env.SAML_ORGS) as Record<string, SamlOrg>;
    const o = Object.prototype.hasOwnProperty.call(all, org) ? all[org] : undefined;
    if (!o || typeof o !== "object") return null;
    for (const k of ["issuer", "audience", "certificate", "ssoUrl"] as const) if (typeof o[k] !== "string" || !o[k]) return null;
    if (!o.mapping || typeof o.mapping !== "object") return null;
    if (new URL(o.ssoUrl).protocol !== "https:") return null;
    return o;
  } catch { return null; }
}

async function deflateRaw(s: string): Promise<Uint8Array> {
  const stream = new Blob([enc.encode(s)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface SamlDeps {
  /** Assertion ids already used. Shared by every request in this isolate. */
  replay?: Map<string, number>;
  now?: () => number;
}

export function createSamlRoutes(deps: SamlDeps = {}) {
  const saml = new Hono<{ Bindings: SamlEnv }>();
  const replay = deps.replay ?? new Map<string, number>();
  const now = () => (deps.now ?? Date.now)();
  const base = (c: any, org: string) => `${new URL(c.req.url).origin}/saml/${org}`;
  const cookiePath = (org: string) => `/saml/${org}`;

  saml.get("/saml/:org/metadata", (c) => {
    const org = c.req.param("org");
    if (!loadSamlOrg(c.env, org)) return fail(c, 404, "unknown_org", "SAML sign-in is not set up for this organization.");
    const xml = `<?xml version="1.0"?><md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${esc(base(c, org))}">` +
      `<md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">` +
      `<md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${esc(base(c, org))}/acs" index="0" isDefault="true"/>` +
      `</md:SPSSODescriptor></md:EntityDescriptor>`;
    return c.body(xml, 200, { "content-type": "application/samlmetadata+xml", "cache-control": "no-store" });
  });

  saml.get("/saml/:org/start", async (c) => {
    const org = c.req.param("org");
    const cfg = loadSamlOrg(c.env, org);
    if (!cfg) return fail(c, 404, "unknown_org", "SAML sign-in is not set up for this organization.");
    const id = `_${rand(24)}`;
    await c.env.POINTERS.put(`saml/req/${id}`, JSON.stringify({ org }), { expirationTtl: REQUEST_TTL });
    const req = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${new Date(now()).toISOString()}" Destination="${esc(cfg.ssoUrl)}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" AssertionConsumerServiceURL="${esc(base(c, org))}/acs"><saml:Issuer>${esc(cfg.audience)}</saml:Issuer></samlp:AuthnRequest>`;
    const u = new URL(cfg.ssoUrl);
    u.searchParams.set("SAMLRequest", b64(await deflateRaw(req)));
    setCookie(c, "sv_saml_req", id, { httpOnly: true, secure: true, sameSite: "None", path: cookiePath(org), maxAge: REQUEST_TTL });
    return c.redirect(u.toString(), 302);
  });

  saml.post("/saml/:org/acs", async (c) => {
    const org = c.req.param("org");
    const cfg = loadSamlOrg(c.env, org);
    if (!cfg) return fail(c, 404, "unknown_org", "SAML sign-in is not set up for this organization.");
    const id = getCookie(c, "sv_saml_req") ?? "";
    deleteCookie(c, "sv_saml_req", { path: cookiePath(org) });
    // Only a response to a request we started in this browser is accepted. Unsolicited responses stop here.
    if (!id) return fail(c, 400, "unsolicited", "Start the sign-in from Shipvo, not from the identity provider.");
    const key = `saml/req/${id}`;
    const raw = await c.env.POINTERS.get(key);
    await c.env.POINTERS.delete(key); // single use
    let saved: { org: string } | null = null;
    try { saved = raw ? JSON.parse(raw) : null; } catch { saved = null; }
    if (!saved || saved.org !== org || !safeEqual(id, key.slice("saml/req/".length))) return fail(c, 400, "unknown_request", "This sign-in was already used or has expired. Start again.");

    let encoded = "";
    try { const form = await c.req.parseBody(); encoded = typeof form.SAMLResponse === "string" ? form.SAMLResponse : ""; } catch { /* handled below */ }
    if (!encoded || encoded.length > MAX_RESPONSE) return fail(c, 400, "bad_response", "The sign-in response is missing or too large.");
    let xml: string;
    try { xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(atob(encoded.replace(/\s+/g, "")), (ch) => ch.charCodeAt(0))); }
    catch { return fail(c, 400, "bad_response", "The sign-in response could not be read."); }

    let result;
    try {
      result = await verifySamlResponse(xml, { issuer: cfg.issuer, audience: cfg.audience, certificate: cfg.certificate, mapping: cfg.mapping, inResponseTo: id, replay }, now());
    } catch (e) {
      if (e instanceof SamlError) {
        if (e.reason === "no role for this user") return fail(c, 403, "no_access", "Your account has no role in Shipvo. Ask an admin.");
        return fail(c, 400, "response_rejected", `The sign-in response was not accepted (${e.reason}).`);
      }
      return fail(c, 400, "response_rejected", "The sign-in response was not accepted.");
    }

    const token = `sv_sso_${rand(32)}`;
    const expires_at = new Date(now() + SESSION_TTL * 1000).toISOString();
    const email = result.attributes.email?.[0] ?? (result.subject.includes("@") ? result.subject : null);
    await c.env.POINTERS.put(`sso/session/${await hex(token)}`, JSON.stringify({ org, sub: result.subject, email, role: result.role, expires_at }), { expirationTtl: SESSION_TTL });
    setCookie(c, "sv_sso", token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: SESSION_TTL });
    return c.json({ ok: true, org, role: result.role, email, expires_at }, 200, { "cache-control": "no-store" });
  });

  return saml;
}

export const samlRoutes = createSamlRoutes();
