import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import worker from "../src/index";
import { allowFromViewer, signWatchToken, verifyWatchToken, addWatchUrl } from "../src/watch";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const O = "https://sim.shipvo.dev"; const SECRET = "test-secret";

function setup(extra: Record<string, unknown> = {}) {
  const sql = new DatabaseSync(":memory:");
  sql.exec("CREATE TABLE api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id, key_hash, prefix, scope, label, expires_at, revoked_at, account_id, last_used_at, quota_minutes, used_minutes DEFAULT 0)");
  sql.exec("CREATE TABLE sim_sessions (mcp_session PRIMARY KEY, sandbox_id, sandbox_host, app_id, scope, rev)");
  sql.exec("CREATE TABLE apps (app_id, account_id, listed, approved, latest_release)");
  sql.exec("CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, github_id, github_login, last_login_at)");
  const DB = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
  return { sql, env: { DB, CONTROL: "x", WATCH_SECRET: SECRET, E2B_API_KEY: "e2b", E2B_API: "https://e2b.test", ...extra } as any };
}
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const getUrl = (u: string, init?: RequestInit) => worker.fetch(new Request(u, init), (globalThis as any).__env);

describe("watch token", () => {
  it("accepts its own session and refuses another, an expired, a tampered and a foreign-signed one", async () => {
    const t = await signWatchToken(SECRET, "s1", 7);
    expect(await verifyWatchToken(SECRET, t, "s1")).toMatchObject({ s: "s1", k: 7 });
    expect(await verifyWatchToken(SECRET, t, "s2")).toBeNull();
    expect(await verifyWatchToken(SECRET, t, "s1", Date.now() + 2 * 3600_000)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = btoa(JSON.stringify({ use: "watch", s: "s1", k: 99, exp: 9999999999 })).replace(/=+$/, "");
    expect(await verifyWatchToken(SECRET, `${forged}.${sig}`, "s1")).toBeNull();
    const i = Math.floor(sig.length / 2);
    const bad = sig.slice(0, i) + (sig[i] === "A" ? "B" : "A") + sig.slice(i + 1);
    expect(await verifyWatchToken(SECRET, `${body}.${bad}`, "s1")).toBeNull();
    expect(await verifyWatchToken("other", t, "s1")).toBeNull();
    expect(await verifyWatchToken(SECRET, "garbage", "s1")).toBeNull();
    expect(await verifyWatchToken(SECRET, "", "s1")).toBeNull();
  });
  it("puts the link in an open_app result and leaves other results alone", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "session: s1\napp: x\nvisible: no\n\n- button \"Go\"" }] } });
    const out = JSON.parse(await addWatchUrl(body, async (s) => `${O}/watch/${s}?t=T`));
    expect(out.result.content[0].text).toContain("The user can watch at https://sim.shipvo.dev/watch/s1?t=T.");
    expect(out.result.structuredContent.watch_url).toBe(`${O}/watch/s1?t=T`);
    expect(out.result.content[0].text.indexOf("watch_url")).toBeLessThan(out.result.content[0].text.indexOf("button"));
    const err = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: "session: s1" }] } });
    expect(await addWatchUrl(err, async () => "x")).toBe(err);
    expect(await addWatchUrl("not json", async () => "x")).toBe("not json");
  });
});

describe("read-only viewer", () => {
  it("cannot act; the owner with Take over can", () => {
    for (const m of ["control", "tap", "swipe", "text", "key"]) {
      expect(allowFromViewer(JSON.stringify({ type: m, on: true }), false)).toBe(false);
      expect(allowFromViewer(JSON.stringify({ type: m, on: true }), true)).toBe(true);
    }
    expect(allowFromViewer("nope", true)).toBe(false);
  });
});

describe("hosted open_app and /watch", () => {
  async function world() {
    const { env, sql } = setup(); (globalThis as any).__env = env;
    const key = "sv_test_abcdefghijklmnop";
    sql.prepare("INSERT INTO api_keys (id, app_id, key_hash, scope, account_id) VALUES (5,'beta',?, 'test', 1)").run(await sha(key));
    sql.prepare("INSERT INTO sim_sessions VALUES ('key:5','sb','https://8787-sb.e2b.test','beta','test',NULL)").run();
    const seen: string[] = []; const orig = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const u = String(input instanceof Request ? input.url : input); seen.push(u);
      if (u.endsWith("/health")) return new Response("ok");
      if (u.includes("/timeout")) return new Response("{}");
      if (u.endsWith("/mcp")) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "session: s1\napp: beta\nvisible: no\n\nscreen" }] } }), { headers: { "content-type": "application/json" } });
      if (u.includes("/watch?")) return new Response(`<html>${u}</html>`, { headers: { "content-type": "text/html" } });
      return new Response("no", { status: 404 });
    }) as any;
    return { env, sql, key, seen, restore: () => { globalThis.fetch = orig; } };
  }
  const open = (key: string) => getUrl(`${O}/mcp`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "open_app", arguments: { app: "beta", platform: "ios" } } }) });

  it("open_app returns watch_url on hosted, and the link opens the page", async () => {
    const w = await world();
    try {
      const r: any = await (await open(w.key)).json();
      const text: string = r.result.content[0].text;
      const url = /The user can watch at (\S+)\.$/m.exec(text)![1];
      expect(url).toMatch(/^https:\/\/sim\.shipvo\.dev\/watch\/s1\?t=/);
      expect(url).not.toContain(w.key);
      const page = await getUrl(url);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("session=s1&only=1&hosted=1");
      expect((await getUrl(url.replace("/watch/s1", "/watch/s2"))).status).toBe(403);          // wrong session
      expect((await getUrl(`${O}/watch/s1?t=${url.split("t=")[1].slice(0, -3)}xyz`)).status).toBe(403);   // tampered
      expect((await getUrl(`${O}/watch/s1`)).status).toBe(403);                                  // no token
    } finally { w.restore(); }
  });
  it("refuses a link whose key was revoked", async () => {
    const w = await world();
    try {
      const url = /watch at (\S+)\.$/m.exec(((await (await open(w.key)).json()) as any).result.content[0].text)![1];
      expect((await getUrl(url)).status).toBe(200);
      w.sql.exec("UPDATE api_keys SET revoked_at = 'x' WHERE id = 5");
      expect((await getUrl(url)).status).toBe(403);
    } finally { w.restore(); }
  });
  it("the socket needs a valid token and an upgrade", async () => {
    const w = await world();
    try {
      expect((await getUrl(`${O}/watch/s1/ws?t=bad`, { headers: { upgrade: "websocket" } })).status).toBe(403);
      const t = await signWatchToken(SECRET, "s1", 5);
      expect((await getUrl(`${O}/watch/s1/ws?t=${t}`)).status).toBe(426);
      expect((await getUrl(`${O}/watch/s1?t=${t}`, { method: "POST" })).status).toBe(405);
    } finally { w.restore(); }
  });
  it("shows the sign-in link, not Take over, to a viewer who is not the owner", async () => {
    const w = await world(); w.env.GITHUB_CLIENT_ID = "id";
    try {
      const t = await signWatchToken(SECRET, "s1", 5);
      await getUrl(`${O}/watch/s1?t=${t}`);
      const sandboxCall = w.seen.find((u) => u.includes("/watch?"))!;
      expect(sandboxCall).toContain("signin="); expect(sandboxCall).not.toContain("takeover=1");
    } finally { w.restore(); }
  });
});
