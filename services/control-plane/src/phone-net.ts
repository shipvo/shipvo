// POST /phone/net: the hosted phone's request proxy, so an app's HTTP calls leave from the control plane and the
// browser applies no CORS. It is not an open relay. Threat notes are in the PR that added it and in docs/phone-network.md.
//
// Request: `x-shipvo-req` = encodeURIComponent(JSON.stringify({ url, method, headers })), raw body as body,
// `x-shipvo-app` = the app id, `authorization: Bearer sv_person_…` = the signed-in session.
// Reply: the real status, headers and body. A refusal is JSON `{ error }` with `x-shipvo-net-error` set.
import { Hono } from "hono";
import { networkHostMatches } from "@shipvo/schema";
import { personId, sha256, type PeopleEnv } from "./people";
import { hit } from "./ratelimit";

export type PhoneNetEnv = PeopleEnv & { NET_MAX_REQUEST_BYTES?: string; NET_MAX_RESPONSE_BYTES?: string; NET_TIMEOUT_MS?: string; NET_RATE_PER_MINUTE?: string; NET_MAX_REDIRECTS?: string };
export type Resolver = (host: string) => Promise<string[]>;

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : d; };
export const netLimits = (env: PhoneNetEnv) => ({
  requestBytes: num(env.NET_MAX_REQUEST_BYTES, 1 << 20), responseBytes: num(env.NET_MAX_RESPONSE_BYTES, 8 << 20),
  timeoutMs: num(env.NET_TIMEOUT_MS, 15_000), perMinute: num(env.NET_RATE_PER_MINUTE, 120), redirects: num(env.NET_MAX_REDIRECTS, 5),
});

/** The allow-list the owner stored for an app (KV `c/<app>/network_allow`, a JSON array of host patterns). Missing or invalid means nothing is allowed. */
export async function loadNetworkAllow(kv: KVNamespace | undefined, appId: string): Promise<string[]> {
  try { const v = JSON.parse((await kv?.get(`c/${appId}/network_allow`)) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}

/* ---------- addresses ---------- */
function v4(ip: string): number[] | null { const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/); if (!m) return null; const o = m.slice(1).map(Number); return o.every((n) => n <= 255) ? o : null; }
function v6(ip: string): number[] | null {   // eight 16-bit groups
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) { const o = v4(tail[1]!); if (!o) return null; s = s.slice(0, -tail[1]!.length) + ((o[0]! << 8) | o[1]!).toString(16) + ":" + ((o[2]! << 8) | o[3]!).toString(16); }
  const halves = s.split("::"); if (halves.length > 2) return null;
  const parse = (p: string) => (p ? p.split(":") : []);
  const a = parse(halves[0]!), b = halves.length === 2 ? parse(halves[1]!) : [];
  const fill = 8 - a.length - b.length; if (halves.length === 1 ? a.length !== 8 : fill < 1) return null;
  const g = [...a, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...b];
  const n = g.map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN));
  return n.length === 8 && n.every((x) => !Number.isNaN(x)) ? n : null;
}
export const isIpLiteral = (h: string) => v4(h) !== null || h.includes(":");

/** True for every address a request from here must never reach: private, loopback, link-local, metadata, shared, multicast, reserved and unparseable. */
export function isBlockedAddress(ip: string): boolean {
  const a = v4(ip);
  if (a) {
    const [o1, o2, o3] = a as [number, number, number, number];
    return o1 === 0 || o1 === 10 || o1 === 127 || o1 >= 224 || (o1 === 100 && o2 >= 64 && o2 <= 127) || (o1 === 169 && o2 === 254) || (o1 === 172 && o2 >= 16 && o2 <= 31)
      || (o1 === 192 && o2 === 168) || (o1 === 192 && o2 === 0 && o3 === 0) || (o1 === 192 && o2 === 0 && o3 === 2) || (o1 === 198 && (o2 === 18 || o2 === 19))
      || (o1 === 198 && o2 === 51 && o3 === 100) || (o1 === 203 && o2 === 0 && o3 === 113);
  }
  const g = v6(ip); if (!g) return true;
  const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;   // ::ffff:a.b.c.d
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);   // 64:ff9b::a.b.c.d
  if (mapped || nat64) return isBlockedAddress(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`);
  if (g.slice(0, 7).every((x) => x === 0) && g[7]! <= 1) return true;   // :: and ::1
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0) return true;   // IPv4-compatible
  return (g[0]! & 0xfe00) === 0xfc00 || (g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xffc0) === 0xfec0 || (g[0]! & 0xff00) === 0xff00 || g[0] === 0x2001 && g[1] === 0x0db8 || g[0] === 0x2002;
}

/** Default resolver: DNS over HTTPS, A and AAAA. Throws when the name does not resolve. */
export const dohResolver: Resolver = async (host) => {
  const one = async (type: "A" | "AAAA") => {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error("dns_failed");
    return (((await r.json()) as { Answer?: { type: number; data: string }[] }).Answer ?? []).filter((x) => x.type === (type === "A" ? 1 : 28)).map((x) => x.data);
  };
  const all = (await Promise.all([one("A"), one("AAAA")])).flat();
  if (!all.length) throw new Error("dns_failed");
  return all;
};

/* ---------- headers ---------- */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "trailers", "transfer-encoding", "upgrade"]);
const NEVER_FORWARD = new Set(["host", "content-length", "cookie2", "origin", "referer", "x-forwarded-for", "x-real-ip", "forwarded", "cf-connecting-ip"]);
const SHIPVO_TOKEN = /\bsv_(?:person|login|assistant|session)_[0-9a-f]+/i;
const SHIPVO_COOKIE = /^(?:sv_|shipvo)/i;
/** The request headers to forward: no hop-by-hop headers, nothing from Shipvo (headers, cookies, tokens), nothing that names the caller. */
export function outboundHeaders(h: Record<string, unknown>): Headers {
  const out = new Headers();
  const named = new Set(String(h["connection"] ?? h["Connection"] ?? "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean));
  for (const [k0, v0] of Object.entries(h)) {
    const k = k0.toLowerCase(); if (typeof v0 !== "string") continue;
    if (HOP_BY_HOP.has(k) || named.has(k) || NEVER_FORWARD.has(k) || k.startsWith("x-shipvo") || k.startsWith("sec-") || k.startsWith("cf-")) continue;
    let v = v0;
    if (k === "cookie") { v = v.split(";").map((x) => x.trim()).filter((c) => c && !SHIPVO_COOKIE.test(c) && !SHIPVO_TOKEN.test(c)).join("; "); if (!v) continue; }
    else if (SHIPVO_TOKEN.test(v)) continue;
    try { out.set(k, v); } catch { /* invalid header name or value: dropped */ }
  }
  return out;
}
/** Response headers to hand back: no hop-by-hop headers and no Set-Cookie (a site's cookies must not land on a Shipvo origin). */
export function inboundHeaders(h: Headers): Headers {
  const out = new Headers(); const named = new Set((h.get("connection") ?? "").toLowerCase().split(",").map((x) => x.trim()));
  h.forEach((v, k) => { if (!HOP_BY_HOP.has(k) && !named.has(k) && k !== "set-cookie" && k !== "content-length" && k !== "content-encoding" && !k.startsWith("access-control-")) out.set(k, v); });
  return out;
}

/* ---------- the route ---------- */
class Refuse extends Error { constructor(public status: number, public code: string) { super(code); } }

/** Checks one hop: scheme, port, credentials, allow-list, then every resolved address. Throws Refuse. */
export async function checkTarget(u: URL, allow: string[], resolve: Resolver): Promise<void> {
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Refuse(400, "bad_scheme");
  if (u.username || u.password) throw new Refuse(400, "credentials_in_url");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Refuse(403, "port_not_allowed");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (isIpLiteral(host)) throw new Refuse(403, isBlockedAddress(host) ? "blocked_address" : "host_not_allowed");
  if (!networkHostMatches(allow, host)) throw new Refuse(403, "host_not_allowed");
  let addrs: string[];
  try { addrs = await resolve(host); } catch { throw new Refuse(502, "dns_failed"); }
  if (!addrs.length || addrs.some(isBlockedAddress)) throw new Refuse(403, "blocked_address");
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const len = Number(res.headers.get("content-length")); if (len > max) throw new Refuse(413, "response_too_large");
  const chunks: Uint8Array[] = []; let n = 0;
  const rd = res.body?.getReader();
  while (rd) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > max) { await rd.cancel().catch(() => {}); throw new Refuse(413, "response_too_large"); } chunks.push(value); }
  const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export function phoneNetRoutes(opts: { resolve?: Resolver; fetch?: typeof fetch } = {}) {
  const r = new Hono<{ Bindings: PhoneNetEnv & { POINTERS?: KVNamespace } }>();
  r.post("/net", async (c) => {
    const started = Date.now();
    const me = await personId(c as any);
    if (me === null) return c.json({ error: "unauthorized" }, 401, { "x-shipvo-net-error": "unauthorized", "cache-control": "no-store" });
    const lim = netLimits(c.env);
    const app = c.req.header("x-shipvo-app") ?? "";
    let desc: { url?: unknown; method?: unknown; headers?: unknown } = {};
    try { desc = JSON.parse(decodeURIComponent(c.req.header("x-shipvo-req") ?? "")); } catch { /* handled below */ }
    let method = typeof desc.method === "string" ? desc.method.toUpperCase() : "GET";
    let url: URL | null = null; try { url = new URL(String(desc.url)); } catch { /* handled below */ }
    const log = async (status: number, refusal: string | null, bytesOut: number, bytesIn: number) => {
      try { await c.env.DB.prepare("INSERT INTO device_log (at, person_id, app_id, kind, method, host, path, status, refusal, ms, bytes_out, bytes_in) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(new Date().toISOString(), me, app.slice(0, 64), "network", method.slice(0, 16), url?.hostname.slice(0, 253) ?? null, url?.pathname.slice(0, 200) ?? null, status, refusal, Date.now() - started, bytesOut, bytesIn).run(); } catch (e) { console.error("device_log write failed", e); }
    };
    const refuse = async (status: number, code: string, bytesOut = 0, extra: Record<string, string> = {}) => {
      await log(status, code, bytesOut, 0);
      return c.json({ error: code }, status as 400, { "x-shipvo-net-error": code, "cache-control": "no-store", ...extra });
    };
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(app)) return refuse(400, "bad_app");
    if (!url) return refuse(400, "bad_request");
    if (!/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method)) return refuse(400, "bad_method");

    // Rate limit per session. Counted before any work, refusals included, so probing the allow-list costs budget too.
    const sess = await sha256((c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    const wait = c.env.POINTERS ? await hit(c.env.POINTERS, "phonenet", { perIp: 0, perInstall: lim.perMinute, perApp: 0, windowSeconds: 60 }, "install", sess) : 0;
    if (wait) return refuse(429, "rate_limited", 0, { "retry-after": String(wait) });

    const declared = Number(c.req.header("content-length"));
    if (declared > lim.requestBytes) return refuse(413, "request_too_large");
    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.length > lim.requestBytes) return refuse(413, "request_too_large", body.length);

    const allow = await loadNetworkAllow(c.env.POINTERS, app);
    const resolve = opts.resolve ?? dohResolver, doFetch = opts.fetch ?? fetch;
    const headers = outboundHeaders((desc.headers && typeof desc.headers === "object" ? desc.headers : {}) as Record<string, unknown>);
    const signal = AbortSignal.timeout(lim.timeoutMs);
    let cur: URL = url, payload: Uint8Array | null = method === "GET" || method === "HEAD" || !body.length ? null : body;
    try {
      for (let hop = 0; ; hop++) {
        url = cur;
        await checkTarget(cur, allow, resolve);   // every hop, so a redirect cannot reach a private address or an undeclared host
        const res = await doFetch(cur.href, { method, headers, body: payload, redirect: "manual", signal });
        const loc = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && loc) {
          if (hop >= lim.redirects) throw new Refuse(502, "too_many_redirects");
          let next: URL; try { next = new URL(loc, cur); } catch { throw new Refuse(502, "bad_redirect"); }
          await res.body?.cancel().catch(() => {});
          if (next.host !== cur.host) { headers.delete("authorization"); headers.delete("cookie"); }
          if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) { method = method === "HEAD" ? "HEAD" : "GET"; payload = null; headers.delete("content-type"); }
          cur = next; continue;
        }
        const data = await readCapped(res, lim.responseBytes);
        await log(res.status, null, body.length, data.length);
        const out = inboundHeaders(res.headers); out.set("cache-control", "no-store");
        return new Response(data, { status: res.status, headers: out });
      }
    } catch (e) {
      if (e instanceof Refuse) return refuse(e.status, e.code, body.length);
      const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
      return refuse(timedOut ? 504 : 502, timedOut ? "timeout" : "upstream_failed", body.length);
    }
  });
  return r;
}
