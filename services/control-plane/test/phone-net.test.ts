import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { Hono } from "hono";
import { peopleRoutes } from "../src/people";
import { AGENT_ACTOR, runOwnerCommand } from "../src/owner";
import { phoneNetRoutes, pruneDeviceLog, loadNetworkAllow, isBlockedAddress, outboundHeaders, inboundHeaders } from "../src/phone-net";

const req_ = createRequire(import.meta.url);
const { DatabaseSync } = req_("node:sqlite");

const DNS: Record<string, string[]> = { "api.shop.dev": ["93.184.216.34"], "cdn.shop.dev": ["2606:2800:220:1::1"], "evil-dns.shop.dev": ["10.0.0.5"], "mixed.shop.dev": ["93.184.216.34", "169.254.169.254"], "other.dev": ["93.184.216.35"] };
function setup(upstream: (u: string, init: RequestInit) => Response | Promise<Response>, env: Record<string, unknown> = {}) {
  const sql = new DatabaseSync(":memory:");
  for (const f of ["0022_people_phone.sql", "0024_device_log.sql"]) sql.exec(req_("node:fs").readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
  const kv = new Map<string, string>();
  const POINTERS = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } } as any;
  kv.set("c/tide/network_allow", JSON.stringify(["api.shop.dev", "*.shop.dev"]));
  const mails: { text: string }[] = [];
  const upstreamCalls: string[] = [];
  const h = new Hono();
  h.route("/people", peopleRoutes(async (_e, m) => { mails.push(m); }));
  h.route("/phone", phoneNetRoutes({ resolve: async (host) => { if (!DNS[host]) throw new Error("nx"); return DNS[host]!; }, fetch: (async (u: string, init: RequestInit) => { upstreamCalls.push(u); return upstream(u, init); }) as any }));
  const e = { DB: db, POINTERS, ...env };
  const signIn = async () => {
    await h.request("/people/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@b.dev" }) }, e);
    const t = mails.at(-1)!.text.match(/sv_login_[0-9a-f]+/)![0];
    const r = await h.request("/people/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t }) }, e);
    return ((await r.json()) as any).session as string;
  };
  const net = (session: string | undefined, url: string, o: { method?: string; headers?: Record<string, string>; body?: string; app?: string } = {}) =>
    h.request("/phone/net", { method: "POST", headers: { ...(session ? { authorization: `Bearer ${session}` } : {}), "x-shipvo-app": o.app ?? "tide", "x-shipvo-req": encodeURIComponent(JSON.stringify({ url, method: o.method ?? "GET", headers: o.headers ?? {} })) }, body: o.body }, e);
  const log = () => sql.prepare("SELECT * FROM device_log ORDER BY id").all() as any[];
  return { net, signIn, log, kv, upstreamCalls, db, e };
}
const ok = () => new Response('{"hello":1}', { status: 200, headers: { "content-type": "application/json", "set-cookie": "a=b", connection: "close" } });

describe("phone request proxy", () => {
  // The same proxy serves the Android and iOS skins: the skin is the page around the app, the request is identical.
  for (const skin of ["Android", "iOS"]) it(`${skin}: a declared host succeeds and is logged`, async () => {
    const { net, signIn, log } = setup(ok);
    const s = await signIn();
    const r = await net(s, "https://api.shop.dev/v1/items?q=1", { headers: { accept: "application/json", "x-shipvo-skin": skin.toLowerCase() } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ hello: 1 });
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(r.headers.get("connection")).toBeNull();
    const [row] = log();
    expect(row).toMatchObject({ kind: "network", app_id: "tide", host: "api.shop.dev", path: "/v1/items", status: 200, refusal: null });
    expect(JSON.stringify(row)).not.toContain("q=1");
  });
  it("refuses an undeclared host", async () => {
    const { net, signIn, log, upstreamCalls } = setup(ok);
    const r = await net(await signIn(), "https://other.dev/x");
    expect(r.status).toBe(403); expect(r.headers.get("x-shipvo-net-error")).toBe("host_not_allowed");
    expect(upstreamCalls).toEqual([]);
    expect(log()[0]).toMatchObject({ refusal: "host_not_allowed", host: "other.dev" });
  });
  it("refuses an app with no declared hosts", async () => {
    const { net, signIn } = setup(ok);
    expect((await net(await signIn(), "https://api.shop.dev/", { app: "unknown-app" })).status).toBe(403);
  });
  it("refuses a name that resolves to a private address, also when only one of several does", async () => {
    const { net, signIn, upstreamCalls } = setup(ok);
    const s = await signIn();
    for (const h of ["evil-dns.shop.dev", "mixed.shop.dev"]) { const r = await net(s, `https://${h}/`); expect(r.status).toBe(403); expect(r.headers.get("x-shipvo-net-error")).toBe("blocked_address"); }
    expect(upstreamCalls).toEqual([]);
  });
  it("refuses IP literals, odd ports and credentials", async () => {
    const { net, signIn } = setup(ok);
    const s = await signIn();
    for (const u of ["http://169.254.169.254/latest/meta-data", "http://127.0.0.1/", "http://[::1]/", "http://[::ffff:10.0.0.1]/", "http://2130706433/", "https://api.shop.dev:8443/", "https://u:p@api.shop.dev/", "file:///etc/passwd"])
      expect((await net(s, u)).status, u).toBeGreaterThanOrEqual(400);
  });
  it("refuses a redirect to a private IP and to an undeclared host", async () => {
    for (const [to, code] of [["http://169.254.169.254/latest/meta-data/", "blocked_address"], ["https://evil-dns.shop.dev/x", "blocked_address"], ["https://other.dev/x", "host_not_allowed"]] as const) {
      const { net, signIn, upstreamCalls, log } = setup((u) => new Response(null, { status: 302, headers: { location: to } }));
      const r = await net(await signIn(), "https://api.shop.dev/start");
      expect(r.status).toBe(403); expect(r.headers.get("x-shipvo-net-error")).toBe(code);
      expect(upstreamCalls).toEqual(["https://api.shop.dev/start"]);
      expect(log()[0]).toMatchObject({ refusal: code });
    }
  });
  it("follows a redirect between declared hosts", async () => {
    const { net, signIn, upstreamCalls } = setup((u) => u.endsWith("/a") ? new Response(null, { status: 301, headers: { location: "https://cdn.shop.dev/b" } }) : ok());
    expect((await net(await signIn(), "https://api.shop.dev/a")).status).toBe(200);
    expect(upstreamCalls).toEqual(["https://api.shop.dev/a", "https://cdn.shop.dev/b"]);
  });
  it("stops a redirect loop", async () => {
    const { net, signIn } = setup(() => new Response(null, { status: 302, headers: { location: "https://api.shop.dev/again" } }));
    const r = await net(await signIn(), "https://api.shop.dev/");
    expect(r.headers.get("x-shipvo-net-error")).toBe("too_many_redirects");
  });
  it("needs a signed-in session", async () => {
    const { net, upstreamCalls, signIn } = setup(ok);
    expect((await net(undefined, "https://api.shop.dev/")).status).toBe(401);
    expect((await net("sv_person_deadbeef", "https://api.shop.dev/")).status).toBe(401);
    await signIn();
    expect((await net("sv_assistant_abc", "https://api.shop.dev/")).status).toBe(401);
    expect(upstreamCalls).toEqual([]);
  });
  it("limits request size, response size and time", async () => {
    const big = setup(() => new Response("x".repeat(100)), { NET_MAX_REQUEST_BYTES: "10", NET_MAX_RESPONSE_BYTES: "50" });
    const s = await big.signIn();
    const a = await big.net(s, "https://api.shop.dev/", { method: "POST", body: "y".repeat(11) });
    expect(a.status).toBe(413); expect(a.headers.get("x-shipvo-net-error")).toBe("request_too_large");
    const b = await big.net(s, "https://api.shop.dev/");
    expect(b.status).toBe(413); expect(b.headers.get("x-shipvo-net-error")).toBe("response_too_large");
    const slow = setup((_u, init) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason))), { NET_TIMEOUT_MS: "20" });
    const c = await slow.net(await slow.signIn(), "https://api.shop.dev/");
    expect(c.status).toBe(504); expect(c.headers.get("x-shipvo-net-error")).toBe("timeout");
  });
  it("rate-limits per session and logs the refusal", async () => {
    const { net, signIn, log } = setup(ok, { NET_RATE_PER_MINUTE: "2" });
    const s = await signIn();
    expect((await net(s, "https://api.shop.dev/")).status).toBe(200);
    expect((await net(s, "https://api.shop.dev/")).status).toBe(200);
    const r = await net(s, "https://api.shop.dev/");
    expect(r.status).toBe(429); expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(log().map((x) => x.refusal)).toEqual([null, null, "rate_limited"]);
  });
  it("never forwards Shipvo tokens or hop-by-hop headers", async () => {
    let seen: Headers = new Headers();
    const { net, signIn } = setup((_u, init) => { seen = new Headers(init.headers); return ok(); });
    const s = await signIn();
    await net(s, "https://api.shop.dev/", { headers: { authorization: `Bearer ${s}`, cookie: "sv_session=1; theme=dark", "x-shipvo-token": "t", connection: "x-custom", "x-custom": "1", "keep-alive": "1", "transfer-encoding": "chunked", "x-api-key": "app-key", accept: "*/*" } });
    expect(seen.get("authorization")).toBeNull();
    expect(seen.get("cookie")).toBe("theme=dark");
    for (const k of ["x-shipvo-token", "connection", "x-custom", "keep-alive", "transfer-encoding"]) expect(seen.get(k), k).toBeNull();
    expect(seen.get("x-api-key")).toBe("app-key"); expect(seen.get("accept")).toBe("*/*");
  });
});

describe("addresses and headers", () => {
  it("blocks every private, loopback, link-local and metadata range", () => {
    for (const ip of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "224.0.0.1", "255.255.255.255", "::", "::1", "fe80::1", "fc00::1", "fd00:ec2::254", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "ff02::1", "nonsense"])
      expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:2800:220:1::1", "::ffff:8.8.8.8"]) expect(isBlockedAddress(ip), ip).toBe(false);
  });
  it("filters headers", () => {
    expect([...outboundHeaders({ Host: "x", "Content-Length": "1", Cookie: "shipvo_s=1", a: "b" }).keys()]).toEqual(["a"]);
    expect([...inboundHeaders(new Headers({ "set-cookie": "a=b", "keep-alive": "1", etag: "1" })).keys()]).toEqual(["etag"]);
  });
});

describe("phone proxy hardening", () => {
  it("answers 503 rate_limit_unavailable when POINTERS is unbound, and calls nothing upstream", async () => {
    const { net, signIn, upstreamCalls, e } = setup(ok);
    const s = await signIn();
    delete e.POINTERS;
    const r = await net(s, "https://api.shop.dev/");
    expect(r.status).toBe(503); expect(r.headers.get("x-shipvo-net-error")).toBe("rate_limit_unavailable");
    expect(upstreamCalls).toEqual([]);
  });
  it("blocks Teredo and 6to4 anycast", () => {
    for (const ip of ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "192.88.99.1"]) expect(isBlockedAddress(ip), ip).toBe(true);
  });
  it("drops authorization and cookie on a cross-host redirect, keeps them on the same host", async () => {
    const seen: Record<string, string | null>[] = [];
    const { net, signIn } = setup((u, init) => {
      const h = new Headers(init.headers); seen.push({ u, a: h.get("authorization"), c: h.get("cookie") });
      if (u.endsWith("/a")) return new Response(null, { status: 302, headers: { location: "/b" } });
      if (u.endsWith("/b")) return new Response(null, { status: 302, headers: { location: "https://cdn.shop.dev/c" } });
      return ok();
    });
    const r = await net(await signIn(), "https://api.shop.dev/a", { headers: { authorization: "Bearer app-token", cookie: "k=v" } });
    expect(r.status).toBe(200);
    expect(seen.map((x) => [x.a, x.c])).toEqual([["Bearer app-token", "k=v"], ["Bearer app-token", "k=v"], [null, null]]);
  });
  it("prunes old device_log rows and keeps recent ones", async () => {
    const { net, signIn, log, db } = setup(ok);
    await net(await signIn(), "https://api.shop.dev/");
    await db.prepare("INSERT INTO device_log (at, person_id, app_id, kind) VALUES (?,?,?,?)").bind("2020-01-01T00:00:00.000Z", 1, "tide", "network").run();
    expect(log()).toHaveLength(2);
    await pruneDeviceLog(db);
    expect(log()).toHaveLength(1); expect(log()[0].at > "2026").toBe(true);
  });
});

describe("set_network_allow", () => {
  const mk = () => {
    const m: Record<string, string> = {}; const audits: any[] = [];
    const kv = { get: async (k: string) => m[k] ?? null, put: async (k: string, v: string) => { m[k] = v; } } as any;
    const db = { prepare: (sql: string) => ({ bind: (...a: any[]) => ({
      first: async () => (sql.includes("content_draft") ? { json: JSON.stringify({ x: 1 }) } : null),
      run: async () => { if (sql.includes("INSERT INTO audit")) audits.push(a); return {}; } }) }) } as any;
    return { m, kv, audits, env: (agent: boolean) => ({ db, kv, appId: "tide", actor: agent ? AGENT_ACTOR : "owner (admin)", agent }) };
  };
  it("refuses an agent token with admin_only and writes nothing", async () => {
    const { m, env } = mk();
    expect((await runOwnerCommand(env(true), "set_network_allow", { hosts: "api.shop.dev" })).error.code).toBe("admin_only");
    expect(m["c/tide/network_allow"]).toBeUndefined();
  });
  it("stores a valid list that loadNetworkAllow reads back, and writes an audit row", async () => {
    const { m, kv, env, audits } = mk();
    const r = await runOwnerCommand(env(false), "set_network_allow", { hosts: "api.shop.dev, *.Cdn.shop.dev" });
    expect(r.ok).toBe(true);
    expect(await loadNetworkAllow(kv, "tide")).toEqual(["api.shop.dev", "*.cdn.shop.dev"]);
    expect(m["c/tide/network_allow"]).toBeDefined();
    expect(audits.some((a) => a[3] === "set_network_allow" && a[5] === 1)).toBe(true);
  });
  it("rejects an IP, a scheme or a port with bad_param and writes nothing", async () => {
    for (const hosts of ["10.0.0.1", "https://api.shop.dev", "api.shop.dev:8443"]) {
      const { m, env } = mk();
      expect((await runOwnerCommand(env(false), "set_network_allow", { hosts })).error.code, hosts).toBe("bad_param");
      expect(m["c/tide/network_allow"], hosts).toBeUndefined();
    }
  });
});
