import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lanAddress, startRunServer } from "../src/run";
import { CookieJar } from "../src/run-net";
import { renderFrame } from "../../sim/frame.mjs";

// A backend with no CORS headers. /count keeps a cookie, /stream sends chunks 80 ms apart.
const backend = () => new Promise<{ s: Server; base: string }>((ok) => {
  const s = createServer(async (req, res) => {
    if (req.url === "/echo") { const b: Buffer[] = []; for await (const c of req) b.push(c as Buffer); res.writeHead(201, { "content-type": "application/octet-stream", "x-seen-method": req.method! }); return void res.end(Buffer.concat(b)); }
    if (req.url === "/count") { const n = Number(/n=(\d+)/.exec(req.headers.cookie ?? "")?.[1] ?? 0) + 1; res.writeHead(200, { "set-cookie": `n=${n}; Path=/` }); return void res.end(String(n)); }
    if (req.url === "/login") { res.writeHead(302, { "set-cookie": "sid=abc; Path=/", location: "/me" }); return void res.end(); }
    if (req.url === "/me") { res.writeHead(200); return void res.end(`sid=${/sid=(\w+)/.exec(req.headers.cookie ?? "")?.[1] ?? "none"} method=${req.method}`); }
    if (req.url === "/stream") { res.writeHead(200, { "content-type": "text/plain" }); let i = 0; const t = setInterval(() => { res.write(`chunk${i++};`); if (i === 3) { clearInterval(t); res.end(); } }, 80); return; }
    res.writeHead(200); res.end("hello");
  }).listen(0, "127.0.0.1", () => ok({ s, base: `http://127.0.0.1:${(s.address() as { port: number }).port}` }));
});
const start = async (platform: "android" | "ios") => {
  const dir = mkdtempSync(join(tmpdir(), "shipvo-net-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><html><head><title>x</title></head><body></body></html>");
  const logs: unknown[] = [];
  const s = await startRunServer({ dir, platform, name: "Tide", render: renderFrame, onNet: (r) => logs.push(r) });
  const origin = `http://127.0.0.1:${s.port}`;
  // The page's own token is in the frame page; read it the way the browser would.
  const page = await (await fetch(origin + "/")).text();
  const token = /data-token="([0-9a-f]+)"/.exec(page)![1];
  const call = (target: string, o: { method?: string; body?: string; session?: string; profile?: string; token?: string | null; headers?: Record<string, string>; extra?: Record<string, string> } = {}) => {
    const h: Record<string, string> = { ...(o.extra ?? {}), origin, "x-shipvo-session": o.session ?? "a", "x-shipvo-profile": o.profile ?? "online", "x-shipvo-req": encodeURIComponent(JSON.stringify({ url: target, method: o.method ?? "GET", headers: o.headers ?? {} })) };
    if (o.token !== null) h["x-shipvo-token"] = o.token ?? token;
    return fetch(origin + "/__shipvo/net", { method: "POST", headers: h, body: o.body });
  };
  return { s, call, logs, origin };
};

describe("run net proxy", () => {
  for (const platform of ["android", "ios"] as const) {
    it(`answers the app from a backend with no CORS headers (${platform})`, async () => {
      const { s, call, logs } = await start(platform); const b = await backend();
      const r = await call(b.base + "/echo", { method: "PUT", body: "abc" });
      expect(r.status).toBe(201);
      expect(r.headers.get("x-seen-method")).toBe("PUT");
      expect(await r.text()).toBe("abc");
      expect(logs[0]).toMatchObject({ method: "PUT", host: new URL(b.base).host, status: 201 });
      await s.close(); b.s.close();
    });
  }
  it("drops the connection for an XMLHttpRequest the profile fails, so the browser raises error", async () => {
    const { s, call } = await start("android");
    const r = call("http://127.0.0.1:9/", { profile: "offline", headers: {} });
    expect((await r).status).toBe(599);
    const x = await call("http://127.0.0.1:9/", { profile: "offline", extra: { "x-shipvo-xhr": "1" } } as never).then(() => "reply", () => "error");
    expect(x).toBe("error");
    await s.close();
  });
  it("injects the client into the app page", async () => {
    const { s, origin } = await start("android");
    const html = await (await fetch(origin + "/app/")).text();
    expect(html).toContain("/__shipvo/net");
    expect(html.indexOf("__shipvo/net")).toBeLessThan(html.indexOf("<title>"));
    await s.close();
  });
  it("keeps the cookie a redirect sets and sends it on the next hop", async () => {
    const { s, call } = await start("android"); const b = await backend();
    const r = await call(b.base + "/login", { method: "POST", body: "x" });
    expect(await r.text()).toBe("sid=abc method=GET");
    expect(r.headers.get("x-shipvo-final-url")).toBe(b.base + "/me");
    expect(await (await call(b.base + "/me", { session: "a" })).text()).toBe("sid=abc method=GET");
    await s.close(); b.s.close();
  });
  it("does not inject the client for a request from the LAN address", async () => {
    const host = lanAddress(); if (!host) return;
    const dir = mkdtempSync(join(tmpdir(), "shipvo-net-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><html><head><title>x</title></head><body></body></html>");
    const s = await startRunServer({ dir, platform: "android", name: "Tide", render: renderFrame, lan: { host } });
    const html = await (await fetch(`http://${host}:${s.port}/app/?t=${s.lanToken}`)).text();
    expect(html).toContain("<title>");
    expect(html).not.toContain("__shipvo/net");
    const local = await (await fetch(`http://127.0.0.1:${s.port}/app/?t=${s.lanToken}`)).text();
    expect(local).toContain("__shipvo/net");
    await s.close();
  });
  it("keeps cookies within a session and apart between sessions", async () => {
    const { s, call } = await start("ios"); const b = await backend();
    expect(await (await call(b.base + "/count", { session: "one" })).text()).toBe("1");
    expect(await (await call(b.base + "/count", { session: "one" })).text()).toBe("2");
    expect(await (await call(b.base + "/count", { session: "two" })).text()).toBe("1");
    await s.close(); b.s.close();
  });
  it("applies offline and slow profiles", async () => {
    const { s, call } = await start("android"); const b = await backend();
    const off = await call(b.base + "/", { profile: "offline" });
    expect(off.status).toBe(599); expect(off.headers.get("x-shipvo-net-error")).toBe("1");
    const t = Date.now(); const slow = await call(b.base + "/", { profile: "2g" });
    expect(Date.now() - t).toBeGreaterThanOrEqual(750);
    expect([200, 599]).toContain(slow.status);
    await s.close(); b.s.close();
  });
  it("refuses a request without the session token or from another origin", async () => {
    const { s, call, origin } = await start("android"); const b = await backend();
    expect((await call(b.base + "/", { token: null })).status).toBe(401);
    expect((await call(b.base + "/", { token: "nope" })).status).toBe(401);
    const r = await fetch(origin + "/__shipvo/net", { method: "POST", headers: { origin: "http://evil.test", "x-shipvo-token": "x" } });
    expect(r.status).toBe(403);
    expect((await fetch(origin + "/__shipvo/net", { method: "POST" })).status).toBe(403);
    await s.close(); b.s.close();
  });
  it("streams a response in chunks", async () => {
    const { s, call } = await start("ios"); const b = await backend();
    const r = await call(b.base + "/stream");
    const reader = r.body!.getReader(); const seen: number[] = []; const t0 = Date.now(); let text = "";
    for (;;) { const { done, value } = await reader.read(); if (done) break; seen.push(Date.now() - t0); text += new TextDecoder().decode(value); }
    expect(text).toBe("chunk0;chunk1;chunk2;");
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[seen.length - 1] - seen[0]).toBeGreaterThanOrEqual(80);
    await s.close(); b.s.close();
  });
  it("cookie jar honours path, domain and expiry", () => {
    const j = new CookieJar(); const u = new URL("http://api.test/a/b");
    j.set(u, "x=1; Path=/a"); j.set(u, "y=2; Max-Age=-1");
    expect(j.header(new URL("http://api.test/a/c"))).toBe("x=1");
    expect(j.header(new URL("http://api.test/z"))).toBe("");
    expect(j.header(new URL("http://other.test/a"))).toBe("");
  });
});
