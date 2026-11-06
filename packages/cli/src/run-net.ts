// `/__shipvo/net` on the `shipvo run` server: the app's HTTP requests leave from Node, so the browser applies no CORS.
// The page sends `POST /__shipvo/net` with the real request described in the `x-shipvo-req` header
// (`encodeURIComponent(JSON.stringify({ url, method, headers }))`), the raw body as the body, the session token in
// `x-shipvo-token`, a session id in `x-shipvo-session` and the network profile in `x-shipvo-profile`.
// The reply carries the real status, headers and body. A request the profile fails answers 599 with `x-shipvo-net-error`.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { hostAllowed, isLoopback, originAllowed, tokenMatches } from "./run-protocol.js";

export const NET_PATH = "/__shipvo/net";
export type NetProfile = { latencyMs: number; downKbps: number; failureRate: number };
export type NetRecord = { at: number; session: string; method: string; host: string; status: number; ms: number; profile: string; error?: string };

type Cookie = { name: string; value: string; domain: string; hostOnly: boolean; path: string; expires?: number; secure: boolean };

/** One cookie jar per phone session, like the cookies of one installed app. */
export class CookieJar {
  private list: Cookie[] = [];
  set(url: URL, header: string, now = Date.now()): void {
    const [pair, ...attrs] = header.split(";").map((x) => x.trim());
    const eq = pair.indexOf("=");
    if (eq < 1) return;
    const c: Cookie = { name: pair.slice(0, eq), value: pair.slice(eq + 1), domain: url.hostname, hostOnly: true, path: defaultPath(url.pathname), secure: false };
    for (const a of attrs) {
      const i = a.indexOf("="); const k = (i < 0 ? a : a.slice(0, i)).toLowerCase(); const v = i < 0 ? "" : a.slice(i + 1);
      if (k === "domain" && v) { c.domain = v.replace(/^\./, "").toLowerCase(); c.hostOnly = false; }
      else if (k === "path" && v.startsWith("/")) c.path = v;
      else if (k === "secure") c.secure = true;
      else if (k === "expires" && c.expires === undefined) { const t = Date.parse(v); if (!Number.isNaN(t)) c.expires = t; }
      else if (k === "max-age" && /^-?\d+$/.test(v)) c.expires = now + Number(v) * 1000;
    }
    if (!c.hostOnly && !(url.hostname === c.domain || url.hostname.endsWith("." + c.domain))) return;
    this.list = this.list.filter((o) => !(o.name === c.name && o.domain === c.domain && o.path === c.path));
    if (c.expires === undefined || c.expires > now) this.list.push(c);
  }
  header(url: URL, now = Date.now()): string {
    this.list = this.list.filter((c) => c.expires === undefined || c.expires > now);
    return this.list
      .filter((c) => (c.hostOnly ? url.hostname === c.domain : url.hostname === c.domain || url.hostname.endsWith("." + c.domain)) && url.pathname.startsWith(c.path) && (!c.secure || url.protocol === "https:"))
      .sort((a, b) => b.path.length - a.path.length)
      .map((c) => `${c.name}=${c.value}`).join("; ");
  }
}
const defaultPath = (p: string) => { const i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); };

const FALLBACK: Record<string, NetProfile> = {
  online: { latencyMs: 0, downKbps: Infinity, failureRate: 0 }, offline: { latencyMs: 0, downKbps: 0, failureRate: 1 },
  "2g": { latencyMs: 800, downKbps: 50, failureRate: 0.02 }, "3g": { latencyMs: 300, downKbps: 750, failureRate: 0.01 },
  "slow-4g": { latencyMs: 150, downKbps: 1600, failureRate: 0 }, spotty: { latencyMs: 400, downKbps: 500, failureRate: 0.3 },
  "low-end-4g": { latencyMs: 100, downKbps: 6300, failureRate: 0.005 },
};
/** The profile table from @shipvo/sim (one source of truth); a built-in copy if that file cannot be loaded. */
export async function loadProfiles(): Promise<Record<string, NetProfile>> {
  try {
    const file = createRequire(import.meta.url).resolve("@shipvo/sim/network-profiles.mjs");
    const mod = await import(new URL(`file://${file.startsWith("/") ? "" : "/"}${file.replace(/\\/g, "/")}`).href);
    return mod.PROFILES as Record<string, NetProfile>;
  } catch { return FALLBACK; }
}

const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer", "content-length", "content-encoding", "set-cookie", "host"]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const readBody = (req: IncomingMessage) => new Promise<Buffer>((ok, fail) => { const b: Buffer[] = []; req.on("data", (c) => b.push(c)); req.on("end", () => ok(Buffer.concat(b))); req.on("error", fail); });
const hostOf = (u: URL) => u.host;

export type NetProxy = { handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>; log: NetRecord[] };

/** The request handler for `NET_PATH`. `tokens` are the credentials it accepts; `port()` is the bound port. */
export function createNetProxy(o: { tokens: string[]; port: () => number; profiles: Record<string, NetProfile>; onRecord?: (r: NetRecord) => void; fetchImpl?: typeof fetch }): NetProxy {
  const jars = new Map<string, CookieJar>();
  const log: NetRecord[] = [];
  const doFetch = o.fetchImpl ?? fetch;
  let draw = 1;
  const random = () => { draw = (Math.imul(draw, 1664525) + 1013904223) >>> 0; return draw / 4294967296; };
  const refuse = (res: ServerResponse, code: number, msg: string) => { res.writeHead(code, { "content-type": "text/plain" }); res.end(msg); };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const port = o.port();
    if (!isLoopback(req.socket.remoteAddress) || !hostAllowed(req.headers.host, port) || req.headers.origin === undefined || !originAllowed(req.headers.origin, port)) return refuse(res, 403, "Forbidden");
    const given = req.headers["x-shipvo-token"];
    if (typeof given !== "string" || !o.tokens.some((t) => tokenMatches(given, t))) return refuse(res, 401, "Unauthorized");
    if (req.method !== "POST") return refuse(res, 405, "Use POST");
    let spec: { url: string; method: string; headers: Record<string, string> };
    try { spec = JSON.parse(decodeURIComponent(String(req.headers["x-shipvo-req"]))); new URL(spec.url); } catch { return refuse(res, 400, "Bad request description"); }
    const url = new URL(spec.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return refuse(res, 400, "Only http and https");
    const session = String(req.headers["x-shipvo-session"] ?? "default").slice(0, 64);
    const profileName = String(req.headers["x-shipvo-profile"] ?? "online");
    const profile = o.profiles[profileName] ?? o.profiles.online;
    const method = String(spec.method || "GET").toUpperCase();
    const started = Date.now();
    const record = (status: number, error?: string) => { const r: NetRecord = { at: started, session, method, host: hostOf(url), status, ms: Date.now() - started, profile: profileName, ...(error ? { error } : {}) }; log.push(r); o.onRecord?.(r); };
    const body = await readBody(req);
    const failed = profile.failureRate >= 1 || random() < profile.failureRate;
    const bytesMs = (n: number) => (n && Number.isFinite(profile.downKbps) && profile.downKbps > 0 ? (n * 8) / profile.downKbps : 0);
    await sleep(profile.latencyMs + bytesMs(body.length));
    if (failed) { record(599, "network request failed"); res.writeHead(599, { "x-shipvo-net-error": "1", "content-type": "text/plain" }); return void res.end("network request failed"); }
    let jar = jars.get(session); if (!jar) jars.set(session, jar = new CookieJar());
    const headers = new Headers();
    for (const [k, v] of Object.entries(spec.headers ?? {})) if (!HOP.has(k.toLowerCase()) && !["cookie", "origin", "referer"].includes(k.toLowerCase())) headers.set(k, v);
    const cookie = jar.header(url); if (cookie) headers.set("cookie", cookie);
    let up: Response;
    try { up = await doFetch(url, { method, headers, body: method === "GET" || method === "HEAD" || body.length === 0 ? undefined : new Uint8Array(body), redirect: "follow" }); }
    catch (e) { record(599, (e as Error).message); res.writeHead(599, { "x-shipvo-net-error": "1", "content-type": "text/plain" }); return void res.end(`network request failed: ${(e as Error).message}`); }
    for (const sc of up.headers.getSetCookie()) jar.set(new URL(up.url || url.href), sc);
    const out: Record<string, string> = { "x-shipvo-final-url": up.url || url.href, "cache-control": "no-store" };
    up.headers.forEach((v, k) => { if (!HOP.has(k)) out[k] = v; });
    res.writeHead(up.status, out);
    record(up.status);
    if (!up.body || method === "HEAD") return void res.end();
    res.on("close", () => { void up.body?.cancel().catch(() => {}); });
    const reader = up.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const wait = bytesMs(value.length); if (wait > 0) await sleep(wait);
      if (!res.write(value)) await new Promise<void>((r) => res.once("drain", r));
    }
    res.end();
  }
  return { handle: (req, res) => handle(req, res).catch(() => { if (!res.headersSent) refuse(res, 500, "Proxy error"); else res.destroy(); }), log };
}

/** The script that runs inside the app's page: sends cross-origin fetch and XMLHttpRequest through `NET_PATH`. */
export function netClientSource(): string { return `(${netClientMain.toString()})`; }
function netClientMain(win: any, cfg: { token: string; session: string; profile: () => string; online: () => boolean; log: (d: any) => void }) {
  const origin = win.location.origin;
  const abs = (u: string) => new win.URL(u, win.location.href);
  const proxied = (u: any) => { try { const x = abs(String(u)); return (x.protocol === "http:" || x.protocol === "https:") && x.origin !== origin ? x : null; } catch { return null; } };
  const meta = (url: any, method: string, headers: Record<string, string>) => ({
    "x-shipvo-token": cfg.token, "x-shipvo-session": cfg.session, "x-shipvo-profile": cfg.profile(),
    "x-shipvo-req": encodeURIComponent(JSON.stringify({ url: url.href, method, headers })),
  });
  const origFetch = win.fetch.bind(win);
  win.fetch = async function (input: any, init?: any) {
    const plain = typeof input === "string" || input instanceof win.URL;
    if (plain && !proxied(input)) return origFetch(input, init);
    const req = new win.Request(input, init);
    const url = proxied(req.url);
    if (!url) return origFetch(input, init);
    const t0 = Date.now(); const headers: Record<string, string> = {}; req.headers.forEach((v: string, k: string) => { headers[k] = v; });
    const fail = () => { cfg.log({ method: req.method, host: url.host, status: 0, ms: Date.now() - t0 }); throw new TypeError("Network request failed"); };
    if (!cfg.online()) fail();
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
    let res: any;
    try { res = await origFetch("/__shipvo/net", { method: "POST", headers: meta(url, req.method, headers), body, signal: req.signal, cache: "no-store" }); } catch { fail(); }
    if (res.headers.get("x-shipvo-net-error")) fail();
    cfg.log({ method: req.method, host: url.host, status: res.status, ms: Date.now() - t0 });
    return res;
  };
  const X = win.XMLHttpRequest;
  if (X) {
    const open = X.prototype.open, send = X.prototype.send, setH = X.prototype.setRequestHeader;
    X.prototype.open = function (method: string, u: any, ...rest: any[]) {
      const url = proxied(u); this.__net = url ? { url, method: String(method).toUpperCase(), headers: {} } : undefined;
      return this.__net ? open.call(this, "POST", "/__shipvo/net", ...rest) : open.call(this, method, u, ...rest);
    };
    X.prototype.setRequestHeader = function (k: string, v: string) { if (this.__net) { this.__net.headers[k] = v; return; } return setH.call(this, k, v); };
    X.prototype.send = function (body?: any) {
      const n = this.__net; if (!n) return send.call(this, body);
      const t0 = Date.now();
      if (!cfg.online()) { cfg.log({ method: n.method, host: n.url.host, status: 0, ms: 0 }); win.setTimeout(() => { this.dispatchEvent(new win.ProgressEvent("error")); }, 0); return; }
      const m = meta(n.url, n.method, n.headers); for (const k of Object.keys(m)) setH.call(this, k, (m as any)[k]);
      this.addEventListener("loadend", () => cfg.log({ method: n.method, host: n.url.host, status: this.status, ms: Date.now() - t0 }));
      return send.call(this, n.method === "GET" || n.method === "HEAD" ? null : body);
    };
  }
}
